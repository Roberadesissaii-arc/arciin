# Architecture

Arciin is a multi-service self-hosted platform. **One server install** owns the database, file storage, API, worker, and web UI. **Client apps** (mobile PWA, browser on another device, future desktop shell) talk to the API only — they never connect to PostgreSQL or own storage.

## Client vs server

| Install type | Where | Runs | Does **not** run |
|--------------|-------|------|------------------|
| **Server** | LattePanda, mini PC, NAS, Docker host | Web (`apps/web`), API, Worker, PostgreSQL, Redis, disk storage | — |
| **Client** | Phone PWA (`arciin-app`), remote browser | UI + API client (HTTP + Socket.IO) | Database, migrations, storage root, worker |

```text
Phone PWA ──────┐
Desktop app ────┼──► HTTPS / WSS
Browser ────────┘         │
                          ▼
              Reverse proxy (Caddy / Nginx / Cloudflare Tunnel)
                          │
                          ▼
              Next.js Web App (apps/web)  ← interface only
                          │
                          ▼
              Arciin API (apps/api)       ← auth, permissions, uploads, paths
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
      PostgreSQL      Redis/BullMQ   File storage
            │             │
            │             └──► Worker (apps/worker)
            └── metadata, users, sessions, jobs
```

The database is **logically central** but **only the API and worker** may access it. The Next.js web app uses `fetchServerApi()` and browser `/api` rewrites — no Prisma in the web layer.

## Startup flow (server install)

When Arciin starts on the server host:

1. Check PostgreSQL is reachable; run migrations if needed (`scripts/arciin-init.sh`).
2. Ensure storage directories exist under `ARCIIN_DATA_DIR`.
3. API and worker start; worker publishes heartbeat to Redis.
4. Web UI loads and calls `/api/instance/status`.
5. If the instance is **not claimed** → redirect to `/setup` (web only on server).
6. If claimed and user is signed out → `/login`.
7. If authenticated → `/dashboard`.

Client apps skip steps 1–4 on the device. They **connect** to an already-claimed server, then sign in.

## Repository layout

```text
arciin/
├── apps/
│   ├── web/          Next.js App Router (dashboard, setup, login)
│   ├── api/          Fastify REST + Socket.IO
│   └── worker/       BullMQ background jobs
├── packages/
│   ├── types/        Shared TypeScript types and events
│   ├── config/       Constants, env schemas, defaults
│   ├── storage/      Filesystem paths, layout, migration
│   ├── ui/           Shared UI tokens and utilities
│   ├── database/     Prisma client (API + worker only)
│   └── shared/       Domain helpers + compatibility barrel
├── prisma/           Schema and migrations (server only)
├── docker/
├── scripts/
└── docs/
```

## Web app (`apps/web`)

Route groups:

- `(setup)` — first-run claim (server install only)
- `(auth)` — login
- `(dashboard)` — authenticated shell

Root `/` gating uses `getRootRouteState()` → setup, login, or dashboard.

The dashboard shell uses shadcn `sidebar-07`: grouped nav, command palette, global upload overlay, Socket.IO status.

## API server (`apps/api`)

Exposes instance, auth, mobile pairing, libraries, folders, assets, uploads, activity, jobs, settings, API keys, chat, webhooks, integrations, admin.

Response shape:

```json
{ "data": {} }
```

Errors:

```json
{ "error": { "code": "ERROR_CODE", "message": "Human readable message" } }
```

## Data model

Prisma models include `InstanceConfig`, `User`, `Session`, `ApiKey`, `StorageLocation`, `Library`, `Folder`, `Asset`, `StorageObject`, `UploadSession`, `Job`, `ActivityEvent`, and extensions (chat, webhooks, password vault, app-databases).

Files stay on disk. PostgreSQL stores metadata only.

## Upload flow

1. Client POSTs to `/api/uploads` (large uploads may bypass Next proxy via direct API origin).
2. API writes temp file, checksum, media type; creates DB rows.
3. BullMQ jobs enqueue analysis and thumbnails.
4. Worker updates DB and publishes realtime events.

## Realtime

Socket.IO authenticates via session cookie (web) or Bearer token (mobile). Rooms: `user:`, `instance:`, `library:`, `upload:`, `job:`.

## Worker

Queues: `analyze_file`, `extract_metadata`, `generate_thumbnail`, `cleanup_temp_files`, `calculate_storage_usage`, integration placeholders.

## Related client: Arciin Mobile

[`arciin-app`](../arciin-app) is a **client-only** PWA. It proxies `/api` to the user's Arciin server, stores session tokens locally, and does **not** run PostgreSQL, Redis, or instance claim. First-run setup happens on the server web UI.

## Request routing (one domain, two apps)

One Cloudflare quick tunnel points at the desktop web app. `apps/web/proxy.ts`
decides per request whether to serve locally or proxy through to the mobile PWA
on its own port, so a single public address serves phones and computers.

`/api` and `/socket.io` always stay on the desktop app, which proxies to Fastify
while preserving the real client IP. Public share and upload links (`/s/`,
`/request/`) stay there too, because those routes exist only in that app.

Full rules and rationale: [`REMOTE_ACCESS.md`](./REMOTE_ACCESS.md).

## Transactional uploads

An upload commits its StorageObject, Asset, UploadSession, Job rows and an
**outbox** row per background job in a single Prisma transaction. Redis is never
touched inside that transaction. Dispatch happens after commit and may fail; a
reconciler drains pending outbox rows every 60 seconds, and job ids are derived
from the work so re-dispatch is a no-op.

This replaced a sequence of separate awaits where a `queue.add` failure left the
asset stranded in `PROCESSING` permanently.

Operational detail: [`OPERATIONS.md`](./OPERATIONS.md).
