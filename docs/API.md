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

Raw API keys are returned once on creation and only hashed values are stored.

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
