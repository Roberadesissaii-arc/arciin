# Architecture

Arciin is a multi-service self-hosted application with a Next.js web app at the repository root and separate API and worker runtimes under `apps/`.

## Services

```txt
Browser
  -> Next.js web app
  -> Fastify API
  -> PostgreSQL
  -> Redis / BullMQ
  -> Worker
  -> Local filesystem storage
```

## Repository layout

```txt
app/                 Next.js App Router pages and layouts
components/          Reusable UI and app-shell components
hooks/               React hooks for auth, queries, uploads, and sockets
lib/                 Frontend API client, validation, stores, and view models

apps/api/            Fastify API server
apps/worker/         BullMQ worker
packages/database/   Shared Prisma client wrapper
packages/shared/     Shared constants, queue names, permissions, and events
prisma/              Prisma schema and seed script
docs/                Architecture, API, development, and deployment docs
docker/              Reverse proxy assets
```

## Web app

The web app is an App Router application with three route groups:

- `(setup)` for first-run claim flow
- `(auth)` for login
- `(dashboard)` for the authenticated shell

The root route performs instance and session gating:

- uninitialized instance -> `/setup`
- initialized but signed out -> `/login`
- authenticated -> `/dashboard`

The dashboard shell is built on the existing shadcn `sidebar` primitive and includes:

- grouped navigation
- command palette
- upload queue
- socket connection status
- global drag-and-drop upload overlay

## API server

The API lives in `apps/api/` and exposes:

- instance claim and status
- local authentication
- libraries, folders, assets, uploads
- activity feed and jobs
- API keys
- storage and remote-access settings
- integrations placeholder routes
- Socket.IO event bridge

All successful responses use:

```json
{ "data": {} }
```

Errors use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

## Data model

Prisma models include:

- `InstanceConfig`
- `User`
- `Session`
- `ApiKey`
- `StorageLocation`
- `Library`
- `Folder`
- `Asset`
- `StorageObject`
- `UploadSession`
- `Job`
- `ActivityEvent`
- `Integration`
- `Tag`
- `AssetTag`

Files stay on disk. PostgreSQL stores metadata, identities, sessions, uploads, jobs, and activity.

## Upload flow

1. The client accepts drag-and-drop or file picker input.
2. Files are POSTed to `/api/uploads` with progress tracked client-side.
3. The API writes a temp file, computes checksum, detects media type, and stores the object.
4. The API creates `StorageObject`, `Asset`, and `UploadSession` rows.
5. BullMQ jobs are created for metadata extraction and thumbnail generation when needed.
6. The worker updates the database and publishes realtime events through Redis.

## Realtime

Socket.IO clients authenticate with the session cookie. The API subscribes to the Redis event channel and forwards events into socket rooms for:

- `user:{userId}`
- `instance:{instanceId}`
- `library:{libraryId}`
- `upload:{uploadId}`
- `job:{jobId}`

## Worker

The worker processes queue jobs for:

- `analyze_file`
- `extract_metadata`
- `generate_thumbnail`
- `cleanup_temp_files`
- `calculate_storage_usage`
- `plex_sync_placeholder`

The worker also writes a Redis heartbeat so the API health route can report worker status.
