# Sharing and File Requests

Two separate folder actions that point in opposite directions:

| | **Share** | **Request files** |
|---|---|---|
| Direction | recipient **reads** | recipient **writes** |
| Sees existing contents | yes, that is the point | **never** |
| Route | `/s/<token>` | `/request/<token>` |
| Needs an account | no | no |

They are deliberately not modes of one feature. Sharing exposes what you chose;
a file request accepts what someone else sends without exposing anything.

---

## Share links

Created from a folder's context menu or the bulk actions bar. Token is generated
with 24 random bytes; only the SHA-256 hash is stored (`ShareLink.tokenHash`),
plus a short prefix so you can recognise a link in the list.

### Availability rules

One policy decides whether a link still serves —
`packages/shared/src/share-availability.ts`, checked in this order:

1. Link does not exist → `NOT_FOUND`
2. Revoked → `REVOKED`
3. Past `expiresAt` → `EXPIRED`
4. View limit reached → `VIEW_LIMIT`
5. **Shared root deleted → `NOT_FOUND`**

Rule 5 was missing until 2026-08-05. Deleting a folder did **not** revoke its
public link: the link kept listing and serving the folder's surviving files to
anyone holding the URL. One such share was live in production.

Deleting something is the most direct way a person revokes access to it. A share
that outlives the delete is a data-exposure bug.

A deleted root reports `NOT_FOUND`, deliberately identical to "never existed",
so a recipient cannot learn that content once lived there. Revocation is still
reported as `REVOKED` because that is checked first and is actionable.

`ASSETS` (multi-file) shares have no single root; their members are filtered
per-asset downstream.

### Pagination

Folder shares use keyset pagination on `(createdAt DESC, id DESC)`. The previous
fixed `take: 500` silently truncated any shared folder holding more than 500
files — the recipient saw a page that looked complete and was not.

The cursor never widens the filter: `folderId` stays pinned to a folder already
proven in-scope, so a recipient cannot page their way out of the shared subtree.
`assetCount` describes the same set that is navigable.

---

## File requests

Give an outsider a link that uploads **into** a folder they cannot read.

Owner: folder context menu → **Request files…**. Configure title, instructions,
expiry, file/byte/size limits, allowed types, required submitter name or email,
and an optional access code. The link is shown **once** — only its hash is
stored.

Recipient: opens `/request/<token>`, sees the title and rules, drops files,
gets a confirmation.

### The security model

The whole model rests on one rule: **the destination is never supplied by the
client.**

Library, folder, instance and owner all come from the resolved `FileRequest`
row. The public request body carries files and submitter details and nothing
else. A public client that could name its own destination folder could write
into any folder on the instance.

The public payload (`toPublicFileRequest`) is built by listing what goes *in*,
not by deleting what must stay out — an omission in a redact-list leaks
silently, an omission here just fails to render. It contains **no** folder id,
library id, instance id, owner identity, or count of what the folder already
holds. Only remaining quota, which is about the submitter's own allowance.

### Enforced on every upload

| Check | Behaviour |
|---|---|
| Request active | revoked → `410`, expired → `410`, quota spent → `409` |
| Access code | Argon2; a dummy verify runs when no code is set so timing does not reveal whether one exists |
| Submitter fields | name/email required per config; a malformed *optional* email is dropped, not rejected |
| Per-file size, total bytes, file count | quota **reserved with a conditional update** before the write, so two submitters racing for the last slot resolve to one winner |
| Allowed extensions / media types | applied to the **content-detected** type, not the filename — renaming `payload.exe` to `photo.jpg` does not get past a jpg allowlist |
| Filename | reduced to its basename, control characters and shell/header-hostile characters stripped, leading dots removed, capped at 200 chars |
| Rate limit | 30 uploads/min per salted abuse identifier, per request |
| Concurrency | 6 simultaneous uploads per request |

Verified live 2026-08-12 against a running instance: anonymous upload succeeded
and landed with correct provenance; wrong and missing access codes were
rejected; the 4th upload against a limit of 3 returned `REQUEST_LIMIT_REACHED`;
a filename of `../../../../etc/passwd` was stored as `passwd` **inside** the
object store; after revoke both the upload and the public page returned `410`.

### What is stored

- Uploaded assets are owned by the **folder's owner** — an anonymous submitter
  has no Arciin identity and the files are the owner's to manage.
- `Asset.fileRequestId` / `fileRequestSubmissionId` record provenance;
  `uploadClient` is `file-request`.
- Submitter IP is stored only as a **salted hash** (`abuseIdentifierHash`),
  enough to rate-limit and recognise a repeat abuser, not enough to recover the
  address.
- Deleting a File Request does **not** delete the files it collected
  (`onDelete: SetNull`). The owner keeps the uploads; only the provenance goes.

### Notifications

One notification per **submission**, not per file. `notifiedAt` is claimed with
a conditional update so a double-submit cannot produce two.

### Not implemented

- No malware scanning. Files are classified by content, not scanned. Do not
  claim otherwise; a scanner would be a pluggable processing job.
- Submitters cannot list or view other submissions, and cannot list their own
  unless `allowSubmitterViewOwn` is set (the viewing UI for that is not built).
