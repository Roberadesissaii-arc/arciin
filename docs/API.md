# API

All routes are served from the Fastify service under the `/api` prefix.

## Health and instance

### `GET /api/health`

Returns service health for:

- API
- database
- Redis
- worker
- storage

### `GET /api/instance/status`

Returns instance state used by the web entrypoint:

```json
{
  "data": {
    "initialized": false,
    "setupRequired": true,
    "instanceName": null,
    "version": "0.1.0"
  }
}
```

### `POST /api/instance/claim`

Claims the instance, creates the first owner, default libraries, storage location, and session cookie.

## Authentication

### `POST /api/auth/login`

Signs in with local email/password credentials and sets the session cookie.

### `GET /api/auth/me`

Returns the current authenticated session.

### `POST /api/auth/logout`

Deletes the active session and clears the cookie.

## Libraries and folders

### `GET /api/libraries`
### `POST /api/libraries`
### `GET /api/libraries/:libraryId`
### `PATCH /api/libraries/:libraryId`
### `DELETE /api/libraries/:libraryId`

### `GET /api/libraries/:libraryId/folders`
### `POST /api/libraries/:libraryId/folders`
### `PATCH /api/folders/:folderId`
### `DELETE /api/folders/:folderId`

## Assets

### `GET /api/assets`

Query params:

- `libraryId`
- `folderId`
- `mediaType`
- `search`

### `GET /api/assets/:assetId`
### `PATCH /api/assets/:assetId`
### `DELETE /api/assets/:assetId`
### `POST /api/assets/:assetId/move`
### `GET /api/assets/:assetId/download`
### `GET /api/assets/:assetId/thumbnail`

## Uploads

### `POST /api/uploads`

Multipart upload endpoint. The API:

- writes temp data
- computes checksum
- verifies MIME type
- routes to a library
- creates `Asset`, `StorageObject`, and `UploadSession`
- enqueues worker jobs when needed

Success is **`201 Created`** with the upload session; `data.assetId` is the new
asset. Clients sending `Expect: 100-continue` (curl for bodies over 1 MB, .NET
`HttpClient`) are supported through the web surface.

`POST /api/uploads` sends the whole file in **one request**. It is the right
choice for small and medium files. It is not the right choice for multi-GB
files: one dropped connection loses the whole upload, and a Cloudflare-proxied
domain on the Free or Pro plan rejects any request body over 100 MB. Do not send
a 2 GB file as one multipart request over Remote Access.

### `GET /api/uploads`
### `GET /api/uploads/:uploadId`
### `POST /api/uploads/:uploadId/complete`
### `POST /api/uploads/:uploadId/cancel`

## Activity and jobs

### `GET /api/activity`
### `GET /api/jobs`
### `GET /api/jobs/:jobId`

## API keys

### `GET /api/api-keys`
### `POST /api/api-keys`
### `DELETE /api/api-keys/:id`

Raw API keys are returned once on creation (`201 Created`) and only hashed
values are stored. New keys expire after 90 days unless `expiresAt` is given,
and carry a per-key rate limit of 600 requests/minute unless
`rateLimitPerMinute` is given (1–100000). Keys created before v1.1.0 keep no
expiry and no per-key limit; the instance-wide limit (Settings → API
protection) still applies to them when set.

## App Data

JSON rows in PostgreSQL, grouped into databases and tables.

| Method | Path | Success |
|---|---|---|
| `GET` | `/api/app-databases` | 200 |
| `POST` | `/api/app-databases` | **201** |
| `GET` / `DELETE` | `/api/app-databases/:databaseId` | 200 |
| `GET` | `/api/app-databases/:databaseId/tables` | 200 |
| `POST` | `/api/app-databases/:databaseId/tables` | **201** |
| `PATCH` / `DELETE` | `/api/app-database-tables/:tableId` | 200 |
| `GET` | `/api/app-database-tables/:tableId/rows` | 200 |
| `POST` | `/api/app-database-tables/:tableId/rows` | **201** |
| `PATCH` | `/api/app-database-rows/:rowId` | 200 — partial update |
| `PUT` | `/api/app-database-rows/:rowId` | 200 — full replace |
| `DELETE` | `/api/app-database-rows/:rowId` | 200 |

`PATCH` merges the payload: objects merge recursively, arrays and primitives
replace, an explicit `null` is stored, and omitted keys are left unchanged. Use
`PUT` (payload required) to remove keys or replace the row. A row can reference
an uploaded file by storing its `assetId` in the payload; there is no foreign
key, by design.

## Resumable File Request uploads

Public File Request links (`/request/:token`) upload through a resumable,
chunked protocol, so a multi-GB file survives dropped connections, page
reloads, server restarts, and Cloudflare's per-request body limit on proxied
domains. Every call
is scoped by the request token: an upload id on its own is useless, and the
client cannot choose the destination folder, library, owner, or path.

`GET /api/public/file-requests/:token` returns:

```json
"upload": { "resumable": true, "chunkSize": 16777216, "maximumUploadBytes": 21474836480 }
```

`chunkSize` is set by the server (`ARCIIN_UPLOAD_CHUNK_SIZE_MB`, default 16,
1–64). `maximumUploadBytes` is the smaller of the request's own limit and the
instance limit from **Settings → Storage → Maximum upload file size**.

| Call | Purpose |
|---|---|
| `POST /api/public/file-requests/:token/uploads` | Create (or resume) a session. Body: `filename`, `sizeBytes`, `mimeType?`, `lastModified?`, `submitterName?`, `submitterEmail?`, `accessCode?`. `201` new, `200` with `resumed: true` for the same file from the same sender. |
| `GET /api/public/file-requests/:token/uploads/:uploadId` | Status: `uploadedBytes`, `totalBytes`, `chunkSize`, `status`, `expiresAt`. Resume from `uploadedBytes`. |
| `PUT /api/public/file-requests/:token/uploads/:uploadId/chunks?offset=N` | `Content-Type: application/octet-stream`; body is exactly `chunkSize` bytes (the final chunk may be shorter). Optional `X-Chunk-SHA256` header (hex). |
| `POST /api/public/file-requests/:token/uploads/:uploadId/complete` | Verifies the streamed SHA-256 (optional body `sha256`), then files the upload. Idempotent. |
| `DELETE /api/public/file-requests/:token/uploads/:uploadId` | Cancel and remove the partial data. |

Rules:

- Chunks are sequential. Resending a chunk the server already has returns
  `200` with `duplicate: true` and changes nothing. Any other offset returns
  `409 INVALID_UPLOAD_OFFSET` with `details.expectedOffset`.
- Free disk space is checked, and reserved for the session, before the first
  byte is accepted: `507 INSUFFICIENT_STORAGE` with `details.requiredBytes` and
  `details.availableBytes`.
- A session may finish after its request expires if it was started before
  expiry, but only within its own lifetime (`ARCIIN_UPLOAD_SESSION_HOURS`,
  default 24). New uploads after expiry get `410 REQUEST_EXPIRED`. Revoking the
  request stops every open session immediately (`410 REQUEST_REVOKED`).
- Unfinished partials are hidden under `temp/resumable/` and removed when their
  session expires or is cancelled. Processing (thumbnails, metadata) runs in
  the background after `complete`.

Client pseudocode:

```text
view    = GET  /public/file-requests/:token
session = POST /public/file-requests/:token/uploads {filename, sizeBytes, lastModified}
offset  = session.uploadedBytes
while offset < size:
  try:
    r = PUT .../uploads/:id/chunks?offset={offset}  body=file[offset : offset+chunkSize]
    offset = r.uploadedBytes
  except network error or 5xx:
    wait 1s, 2s, 4s, 8s, 16s; then offset = GET .../uploads/:id .uploadedBytes
  except 409 INVALID_UPLOAD_OFFSET as e:
    offset = e.details.expectedOffset
POST .../uploads/:id/complete {sha256?}
```

## Settings

### `GET /api/settings/uploads`
### `PATCH /api/settings/uploads`

`maxUploadSizeMb` is the largest single file accepted (owner or admin to
change). It is a ceiling only; every upload is also checked against free disk
space.

### `GET /api/settings/storage`
### `PATCH /api/settings/storage`
### `GET /api/settings/remote-access`
### `PATCH /api/settings/remote-access`

## Integrations

### `GET /api/integrations`
### `GET /api/integrations/plex`
### `PATCH /api/integrations/plex`

Plex is intentionally placeholder-first in this MVP.

## Status codes and errors

Every error is JSON: `{"error":{"code","message","details?"}}` — never an empty
body.

| Status | `error.code` | When |
|---|---|---|
| 200 | — | read, update, delete |
| 201 | — | every create (uploads, app databases, tables, rows, folders, API keys, shares, webhooks) |
| 400 | `VALIDATION_ERROR` | invalid body or query |
| 401 | `UNAUTHENTICATED` | missing, unknown, revoked, or expired credential |
| 403 | `FORBIDDEN` | valid key without the route's scope |
| 404 | `NOT_FOUND` | missing, or not visible to this caller |
| 409 | `ALREADY_EXISTS` | unique name already used |
| 409 | `INVALID_UPLOAD_OFFSET` | chunk sent at the wrong offset; see `details.expectedOffset` |
| 409 | `UPLOAD_INCOMPLETE` | `complete` called before every byte arrived |
| 410 | `UPLOAD_SESSION_EXPIRED` | the resumable session outlived its lifetime |
| 410 | `REQUEST_EXPIRED` / `REQUEST_REVOKED` | the File Request no longer accepts uploads |
| 413 | `UPLOAD_TOO_LARGE` | file exceeds the maximum upload size; see `details.maximumUploadBytes` |
| 422 | `CHECKSUM_MISMATCH` | the assembled file does not match the declared SHA-256 |
| 429 | `RATE_LIMITED` | per-key limit reached; see `Retry-After` |
| 429 | `TOO_MANY_UPLOADS` | too many unfinished uploads on one request or from one sender |
| 507 | `INSUFFICIENT_STORAGE` | not enough free disk space for this file |
| 502 | `UPSTREAM_UNAVAILABLE` | the web surface could not reach the API |

Keyed responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset`.

## Authorization model

Roles:

- `OWNER`
- `ADMIN`
- `MEMBER`
- `VIEWER`

Typical permission split:

- `OWNER` / `ADMIN`: settings, integrations, API keys
- `MEMBER`: upload, move, create folders, manage assets
- `VIEWER`: read-only access
