# Arciin

**Your server, your control.**

Arciin is a self-hosted private file, library, and media management platform. Run it on your own machine or VPS: organize videos, images, music, and documents in libraries, upload from the browser or scripts, and watch activity in real time. No cloud account required.

<p align="center">
  <img src="./public/assets/images/dashboard.png" alt="Arciin dashboard — libraries, storage overview, and activity" width="900" />
  <br />
  <em>Dashboard after setup — libraries, storage, uploads, and live activity.</em>
</p>

<p align="center">
  <img src="./public/assets/images/Sign_up..png" alt="Arciin first-run setup — claim your instance" width="900" />
  <br />
  <em>First visit — claim the instance with your setup token and create the owner account.</em>
</p>

---

## Table of contents

- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Development](#development)
- [Environment variables](#environment-variables)
- [Python & API examples](#python--api-examples)
- [Docker](#docker)
- [Project layout](#project-layout)
- [Documentation](#documentation)

---

## What you get

| Area | Description |
|------|-------------|
| **First-run setup** | One-time instance claim with `ARCIIN_SETUP_TOKEN`, then local admin login |
| **Libraries** | Videos, Images, Music, Documents, and Inbox — with folders inside each library |
| **Uploads** | Drag-and-drop anywhere in the app, upload queue, and multipart API for scripts |
| **Realtime** | Socket.IO events for uploads, assets, jobs, and activity (`/events` monitor) |
| **Notifications** | In-app inbox, sounds, and badges when uploads complete |
| **Developer** | API keys, webhooks placeholder, Python examples under `scripts/examples/` |
| **Ops** | Logs page, jobs, storage settings, optional Plex/Jellyfin integration guides |

The public marketing site is intentionally **not** the focus yet — this repo is the real application.

---

## How it works

Arciin is a **monorepo** with three runtime processes plus infrastructure:

```text
Browser  →  Next.js (web)     :3000   UI, auth cookies, /api proxy, /socket.io proxy
              ↓
           Fastify (API)       :4000   REST, uploads, sessions, Socket.IO server
              ↓
PostgreSQL              metadata (users, libraries, assets, jobs, …)
Redis                   pub/sub for realtime events + BullMQ
Local disk              file bytes under ARCIIN_DATA_DIR (default ./data/arciin)
BullMQ worker           thumbnails, metadata, background jobs
```

**Typical first visit**

1. Open `http://localhost:3000` → redirected to **Setup** if the instance is new.
2. Enter the setup token, instance name, admin email/password, and storage path.
3. Log in → **Dashboard** with sidebar navigation.
4. Drag files into the app (or use `scripts/examples/upload_image_example.py`) → files land in the right library; events appear on **Events** and **Notifications**.

**Root route behavior**

| State | Redirect |
|-------|----------|
| Instance not initialized | `/setup` |
| Not logged in | `/login` |
| Authenticated | `/dashboard` |

---

## Prerequisites

- **Linux** or **WSL2** (recommended for development)
- **Node.js** 20+ (installer targets Node 24)
- **pnpm** 10+ (`corepack enable` works)
- **PostgreSQL** 14+
- **Redis** 6+
- **FFmpeg** / **ffprobe** (media processing in the worker)

Optional: **Docker** and **Docker Compose** for containerized deployment.

---

## Quick start

### 1. Clone the repository

```bash
git clone https://github.com/Roberadesissaii-arc/arciin.git
cd arciin
```

### 2. Run the installer

The installer checks dependencies, installs pnpm packages, creates `.env` if missing, runs migrations, seeds defaults, and prepares storage directories.

```bash
chmod +x install.sh
./install.sh
```

Optional flags:

```bash
ARCIIN_UPGRADE_SYSTEM=1 ./install.sh   # also apt-install missing system packages (Debian/Ubuntu)
ARCIIN_SKIP_DB_INIT=1 ./install.sh      # skip database migrate/seed
```

### 3. Configure environment

If `.env` was created for you, review it. Otherwise:

```bash
cp .env.example .env
```

Important values:

- `ARCIIN_SETUP_TOKEN` — required on the setup screen (installer may generate one)
- `SESSION_SECRET` — change in production (`openssl rand -hex 32`)
- `DATABASE_URL` / `REDIS_URL` — match your local Postgres and Redis

### 4. Start the stack

```bash
pnpm dev
```

This runs **web**, **api**, and **worker** together:

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| API | http://localhost:4000/api |
| Health | http://localhost:4000/api/health |

### 5. Claim your instance

1. Open http://localhost:3000
2. Use the setup token from `.env` (`ARCIIN_SETUP_TOKEN`)
3. Create the first administrator (becomes **OWNER**)
4. Sign in and explore the dashboard

---

## Development

### Install dependencies only

```bash
pnpm install
pnpm db:generate
```

### Run processes separately

```bash
pnpm dev:web      # Next.js on :3000
pnpm dev:api      # Fastify on :4000
pnpm dev:worker   # BullMQ consumer
```

### Database commands

```bash
pnpm db:migrate    # apply migrations (dev)
pnpm db:deploy     # apply migrations (production)
pnpm db:seed       # seed defaults
pnpm db:studio     # Prisma Studio
```

### Quality checks (CI uses these)

```bash
pnpm lint
pnpm typecheck
pnpm check         # lint + typecheck + build (web, api, worker)
```

### WSL: Python on Windows, Arciin in WSL

```bash
bash scripts/examples/arciin_wsl_hosts.sh
```

Set `API_BASE` in `scripts/examples/arciin_example_client.py` to the printed WSL IP (e.g. `http://172.22.212.155:4000/api`). The browser UI stays on http://localhost:3000.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for queues and realtime pub/sub |
| `ARCIIN_DATA_DIR` | On-disk storage root (default `./data/arciin`) |
| `ARCIIN_SETUP_TOKEN` | Secret for first-run setup only |
| `ARCIIN_PUBLIC_URL` | Browser-facing URL (e.g. `http://localhost:3000`) |
| `ARCIIN_API_URL` | API origin for server-side use |
| `SESSION_SECRET` | Session cookie signing (32+ chars in production) |
| `NEXT_PUBLIC_API_BASE_URL` | Usually `/api` (proxied to Fastify) |
| `NEXT_PUBLIC_ARCIIN_API_ORIGIN` | Direct API URL for large uploads in dev (`http://localhost:4000`) |
| `NEXT_PUBLIC_SOCKET_URL` | Leave **empty** in local dev so cookies work via `:3000` proxy |

See `.env.example` for the full list.

---

## Python & API examples

Runnable scripts live in **`scripts/examples/`**. Edit shared config once in `arciin_example_client.py`, then run any example:

```bash
pip install requests
# Socket.IO: pip install "python-socketio[client]" websocket-client
```

| Script | What it does |
|--------|----------------|
| `health_check_example.py` | Ping API health |
| `list_libraries_example.py` | List libraries and ids |
| `create_folder_example.py` | Create a folder |
| `upload_image_example.py` | Upload to Images |
| `upload_video_example.py` | Upload to Videos |
| `socket_events_example.py` | Listen for live events |

Details: [`scripts/examples/README.md`](./scripts/examples/README.md)

Create API keys in the app: **Developer → API keys** (scopes such as `uploads:create`, `libraries:read`, `events:subscribe`).

---

## Docker

```bash
cp .env.example .env
# Edit ARCIIN_SETUP_TOKEN, SESSION_SECRET, and URLs for your host

docker compose up --build -d
```

Open the URL configured for the web service (see `docker-compose.yml` and `docker/caddy/Caddyfile`).

Images:

- `Dockerfile.web` — Next.js
- `Dockerfile.api` — Fastify API
- `Dockerfile.worker` — background worker

---

## Project layout

```text
arciin/
├── app/                    # Next.js App Router (UI)
├── apps/
│   ├── api/                # Fastify REST + Socket.IO
│   └── worker/             # BullMQ jobs (thumbnails, metadata, …)
├── components/             # React UI
├── packages/
│   ├── database/           # Prisma client wrapper
│   └── shared/             # shared types and constants
├── prisma/                 # schema and migrations
├── scripts/examples/       # Python integration examples
├── public/assets/images/   # README screenshots and static assets
├── docker/                 # Caddy and deployment helpers
├── docker-compose.yml
└── install.sh              # first-time setup script
```

---

## Tech stack

**Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, Zustand, Socket.IO client

**Backend:** Fastify, Prisma, PostgreSQL, Redis, BullMQ, Socket.IO, Sharp, FFmpeg

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) | Day-to-day dev notes |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Production and self-hosting |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System design |
| [`docs/API.md`](./docs/API.md) | API overview |
| In-app **Documentation** | Full REST manual at `/docs` when running |

Also see [`AGENTS.md`](./AGENTS.md) for contributor conventions.

---

## License

Private / project-specific — see repository settings for license terms if published.

---

<p align="center">
  <strong>Arciin</strong> — built for the system you own.
</p>
