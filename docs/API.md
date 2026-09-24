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

## Settings

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
| 429 | `RATE_LIMITED` | per-key limit reached; see `Retry-After` |
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
