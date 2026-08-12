# Security model

What Arciin defends, how, and what it does not defend. Only implemented
behaviour is described.

## Credentials at rest

| Secret | Storage |
|---|---|
| User passwords | Argon2id hash |
| Session tokens | SHA-256 hash (`Session.tokenHash`) |
| API keys | SHA-256 hash + visible prefix |
| Share / file-request tokens | SHA-256 hash + prefix; raw value shown once |
| File-request access codes | Argon2 hash |
| SMTP password, Discord webhook | AES-256-GCM ciphertext |
| Password vault entries | AES-256-GCM ciphertext |
| Submitter IP addresses | Salted SHA-256, never the address |

Nothing in that table is ever returned by the API. Settings endpoints report
booleans (`hasPassword`, `configured`) instead.

Encryption keys derive from `ARCIIN_ENCRYPTION_KEY`, falling back to
`SESSION_SECRET`, with per-domain salts so subkeys are separated.

## Session tokens are not accepted in query strings

Media elements cannot send headers, which historically pushed a session token
into `?access_token=`. That leaks into referrers, proxy logs and browser
history. Replaced with **short-lived, per-asset media tokens**; the remaining
`access_token` parameter is redacted before any request is logged.

## Public endpoints

Three surfaces are reachable without authentication:

| Surface | Route | Writes? |
|---|---|---|
| Share | `/api/shares/access/:token` | no |
| File request (read) | `/api/public/file-requests/:token` | no |
| File request (upload) | `/api/public/file-requests/:token/submissions` | **yes** |

The upload endpoint is the only unauthenticated write in the product. Its rules
are in [`SHARING.md`](./SHARING.md); the load-bearing one is that **the
destination is never supplied by the client** — library, folder, instance and
owner all come from the resolved request row.

### Existence oracles

Unavailable resources report `NOT_FOUND` rather than a specific reason wherever
the reason would disclose that something once existed:

- A deleted share root is indistinguishable from a share that never existed.
- An upload session you do not own returns 404, not 403.
- A file request whose destination folder was deleted returns `NOT_FOUND`.

Revoked and expired links *do* say so, because that is actionable and does not
reveal content.

## The assistant

The chat assistant can read library documents and act on the instance, so it is
treated as a partly-untrusted channel: text inside a PDF it reads is attacker-
controlled input.

**File delivery tools take no destination argument.** `send_asset_to_email` and
`send_asset_to_discord` accept a file and an optional note — never a recipient.
A destination parameter would let a sentence inside any document redirect an
attachment to a stranger. `tests/delivery-policy.test.ts` fails if such an
argument is reintroduced.

**Library tool access is policy-gated** (`libraryToolAccess`: full /
folder-mutations / vision-only), with separate settings for injection blocking,
secret redaction and password-vault exposure under Settings → AI Security.

**Rendered LaTeX is inert.** Formulas are typeset with KaTeX using
`trust: false`, so `\href` and `\includegraphics` render as text rather than
links or fetches. The output is injected as HTML, so this is a boundary, not a
default — a test asserts `trust: true` *would* produce a real link, guarding
against someone "simplifying" the option away.

## Upload safety

- Filenames are reduced to their basename under both separators, stripped of
  control characters (including NUL) and shell/header-hostile characters, and
  capped. Verified: `../../../../etc/passwd` stores as `passwd` inside the
  object store.
- Type checks use **content detection**, not the filename, so renaming
  `payload.exe` to `photo.jpg` does not pass an extension allowlist.
- Storage is content-addressed under `objects/<aa>/<bb>/<sha256>`; client paths
  are never trusted.
- OOXML detection reads the zip central directory and **never inflates**, so a
  zip bomb cannot be triggered by classification.

## Network

- CORS allows the configured public URL, any RFC-1918 LAN origin, and
  `*.trycloudflare.com` over HTTPS — necessary because the tunnel hostname
  changes on every restart.
- The hosted mobile companion proxy validates every upstream before fetching:
  blocks `javascript:`/`file:`, cloud-metadata IPs (`169.254.169.254`),
  link-local addresses, and requires HTTPS for non-LAN hosts. On Vercel it
  refuses LAN targets entirely.
- Optional IP allow/block lists and global rate limiting under Settings → API
  protection.

## Not implemented

Say so plainly rather than implying coverage:

- **No malware scanning** of uploads, including File Request submissions.
- **No end-to-end encryption.** Files are encrypted at rest only if the
  underlying disk is.
- **No audit log export.** Security events are recorded as activity rows.
- **No 2FA.**
- **No signed release artifacts.**

## Reporting

This is a self-hosted product with no vendor-operated service. If you find a
vulnerability, open an issue on the repository.
