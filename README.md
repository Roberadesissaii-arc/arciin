# Arciin

**Your server, your control.**

Arciin is a self-hosted private file, library, and media management platform. Run it on your own machine — organize videos, images, music, and documents into libraries, upload from the browser or scripts, and watch activity update in real time. No cloud account required.

<p align="center">
  <img src="./apps/web/public/assets/images/dashboard.png" alt="Arciin dashboard" width="900" />
  <br />
  <em>Dashboard — libraries, storage overview, uploads, and live activity.</em>
</p>

<p align="center">
  <img src="./apps/web/public/assets/images/Sign_up..png" alt="Arciin first-run setup" width="900" />
  <br />
  <em>First visit — claim the instance with your setup token and create the owner account.</em>
</p>

---

## Table of contents

- [What you get](#what-you-get)
- [Arciin Mobile (companion PWA)](#arciin-mobile-companion-pwa)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Managing Arciin](#managing-arciin)
- [Development](#development)
- [Environment variables](#environment-variables)
- [Python & API examples](#python--api-examples)
- [Docker](#docker)
- [Project layout](#project-layout)
- [Documentation](#documentation)

---

## What you get

### Core platform

| Area | Description |
|------|-------------|
| **First-run setup** | One-time instance claim with `ARCIIN_SETUP_TOKEN`, then local admin login (no public signup) |
| **Dashboard** | Storage overview, library counts, recent uploads, live activity, jobs, and quick access |
| **Libraries** | Videos, Images, Music, Documents, and Inbox — folders inside each library |
| **All Files** | Cross-library search and browsing |
| **Global uploads** | Drag-and-drop anywhere in the authenticated app; intelligent routing by file type |
| **Upload queue** | Progress, retries, and realtime status via Socket.IO |
| **Activity feed** | Uploads, moves, deletes, and system events with live updates |
| **Jobs monitor** | Background work: thumbnails, metadata, transcoding helpers |
| **Notifications** | In-app inbox, optional sounds, and badges when uploads complete |

### Files & media

| Area | Description |
|------|-------------|
| **File preview** | Images, video, PDF, and code/text in a full workspace viewer |
| **PDF preview** | Continuous scroll, zoom (default 75%), bookmarks, page chrome |
| **Ask AI (preview)** | Side panel on open files — summarize, Q&A, navigate chapters/pages, highlight text on PDFs |
| **PDF navigation** | Chapter and printed-page index (book page numbers vs PDF page index) |
| **Music player** | Play audio from the library in a persistent bottom bar while you browse |
| **Thumbnails** | Generated in the worker for images, video posters, and PDF pages |

### AI & automation

| Area | Description |
|------|-------------|
| **AI Chat** | Local (Ollama) and cloud model profiles; streaming replies; tool use on the library |
| **Models** | Configure providers, defaults, and vision-capable profiles |
| **Library tools** | Vision search, image organization, read text assets, folder create/delete (when enabled) |
| **Password vault (AI)** | Encrypted vault context for local-model password questions (security settings) |

### Security & admin

| Area | Description |
|------|-------------|
| **Roles** | Owner, Admin, Member, Viewer |
| **API keys** | Scoped keys with hashed storage; prefix display; revoke |
| **Webhooks & events** | Developer integrations and live event monitor |
| **Sessions** | Active devices; sign out remotely |
| **Password vault** | Encrypted saved logins (desktop UI) |
| **Settings** | Storage root, domain/tunnel, remote access, security, users |
| **Database browser** | Inspect app tables and app-data records (admin) |
| **Logs** | Server log tail for operators |

### Integrations

| Area | Description |
|------|-------------|
| **Plex / Jellyfin** | Folder layout guides and connector placeholders |
| **Mobile pairing** | Generate 6-digit codes under Settings → Mobile connection for the companion app |
| **Python examples** | `scripts/examples/` — upload, folders, health, Socket.IO |

### Realtime & ops

| Area | Description |
|------|-------------|
| **Socket.IO** | Upload progress, assets, jobs, activity |
| **Docker** | Compose stack with Caddy, Postgres, Redis, web, API, worker |
| **PM2 / native** | `install.sh` and `scripts/start.sh` for bare-metal installs |

---

## Arciin Mobile (companion PWA)

Use **[Arciin Mobile](https://github.com/Roberadesissaii-arc/arciin-app)** on your phone — it connects to **this** server, not a hosted Arciin cloud.

| Step | Where |
|------|--------|
| 1. Run Arciin (this repo) on your server | Docker or native install below |
| 2. Claim instance and sign in on desktop | `http://<server>:3004` |
| 3. Generate a pairing code | **Settings → Mobile connection** |
| 4. Install the mobile PWA | Vercel deploy or `pnpm dev:mobile` from `arciin-app` |
| 5. Pair once, then sign in | Server URL + 6-digit code + email/password |

The mobile app supports home overview, files, uploads, jobs, activity, **AI chat**, models, notifications, profile/settings, password vault, API keys, and offline reconnect when the server is unreachable. See the mobile README for deploy and troubleshooting.

---

## Prerequisites

Pick **one** install path:

| Path | You need on the host |
|------|----------------------|
| **Docker** (recommended for most installs) | [Docker](https://docs.docker.com/engine/install/) + Compose plugin |
| **Native** (`./install.sh`) | Linux/WSL2, Node 20+, pnpm, PostgreSQL 14+, Redis 6+, FFmpeg |

---

## Quick start

### 1. Clone

```bash
git clone https://github.com/Roberadesissaii-arc/arciin.git
cd arciin
```

### 2. Install

**Docker** (Ubuntu Server, NAS, home lab, or when native apt fails):

```bash
chmod +x scripts/docker-setup.sh install.sh
./install.sh --docker
# or: ./scripts/docker-setup.sh
```

You will choose (or set) **`ARCIIN_HOST_DATA_DIR`** — the real folder on your SSD/HDD where files are stored (default `/srv/arciin-storage/arciin`). This is **not** `/data/arciin` (that path only exists inside containers). Mount USB/SATA disks on the host first — Settings → Storage detects unmounted drives. See [`docs/DOCKER.md`](./docs/DOCKER.md).

**Native** (PM2 on the host — Arceserver-style servers):

```bash
chmod +x install.sh
./install.sh
```

On **Raspberry Pi** (or any machine with a separate SSD), mount the large disk **before** or **during** install. `./install.sh` can list unmounted drives (`lsblk`) and guide you; after mount, use e.g. `/mnt/arciin-sda1/arciin` as `ARCIIN_DATA_DIR`. Settings → Storage also lists unmounted drives and shows mount commands. Do **not** use `/data/arciin` on native — that path is only for files inside Docker containers.

Optional flags:

```bash
ARCIIN_UPGRADE_SYSTEM=1 ./install.sh   # also apt-install missing system packages
ARCIIN_SKIP_DB_INIT=1  ./install.sh    # skip migrate + seed
ARCIIN_SKIP_SYSTEM_PACKAGES=1 ./install.sh   # skip apt (deps already installed)
```

### 3. Configure `.env`

Review the generated `.env`. Key values:

| Variable | What to set |
|----------|-------------|
| `ARCIIN_SETUP_TOKEN` | Required on the setup screen |
| `SESSION_SECRET` | Change in production — `openssl rand -hex 32` |
| `DATABASE_URL` | Your PostgreSQL connection string |
| `REDIS_URL` | Your Redis URL |
| `ARCIIN_PUBLIC_URL` | Browser-facing URL, e.g. `http://192.168.1.10:3004` |

### 4. Start

```bash
bash scripts/start.sh
```

Or using PM2 directly:

```bash
pm2 start ecosystem.config.cjs
```

| Service | Default URL |
|---------|-------------|
| Web UI | http://localhost:3004 |
| API | http://localhost:4001/api |
| Health | http://localhost:4001/api/health |

### 5. Claim your instance

1. Open `http://<your-server-ip>:3004`
2. Enter the setup token from `.env` (`ARCIIN_SETUP_TOKEN`)
3. Fill in instance name, admin email, password, and storage path
4. Check **I have read and agree** — the Claim button activates
5. Sign in and explore the dashboard

> **The setup token is never pre-filled for you.** Copy it out of `.env` yourself.
> An unclaimed instance answers `/api/instance/status` without authentication, so
> anything that could reach the server would otherwise be able to read the token and
> claim your instance first. Claiming locks setup permanently.

---

## Managing Arciin

### Start and stop

```bash
bash scripts/start.sh     # Start all processes
bash scripts/stop.sh      # Stop all processes
```

### PM2 commands

```bash
pm2 status                # Process list — web, api, worker
pm2 logs arciin-web       # Live web logs
pm2 logs arciin-api       # Live API logs
pm2 logs arciin-worker    # Live worker logs
pm2 restart all           # Restart everything (required after .env changes)
pm2 restart arciin-api    # Restart API only
pm2 monit                 # CPU / memory dashboard
```

### Database

```bash
pnpm db:migrate    # Apply migrations (dev)
pnpm db:deploy     # Apply migrations (production)
pnpm db:seed       # Seed default libraries
pnpm db:studio     # Open Prisma Studio
```

### Production update (pull, build, restart)

When you change code on the server or pull a new release from git, run this from the project root:

```bash
cd /path/to/arciin
git pull
pnpm install
pnpm exec prisma migrate deploy
pnpm build
pm2 restart arciin-api arciin-web arciin-worker
```

Shortcut (web rebuild + PM2 restart):

```bash
pnpm deploy
```

If `arciin-web` shows **errored** and logs say *Could not find a production build*, run `pnpm build` before restart (build output lives in `apps/web/.next`).

If you only changed environment variables (`.env`):

```bash
pm2 restart arciin-api arciin-web arciin-worker
```

Quality gate before shipping changes:

```bash
pnpm typecheck
pnpm build
```

### Browser features that need HTTPS

Reaching Arciin over a plain-HTTP LAN address (`http://192.168.x.x:3004`) is fully
supported, but browsers disable some APIs outside a *secure context* — HTTPS, or
`localhost`. This is a browser rule, not an Arciin setting, and no amount of
server config changes it:

| Feature | On plain HTTP over LAN IP |
|---------|---------------------------|
| **Copy buttons** | Work — Arciin falls back to a legacy copy path |
| **Native share sheet** (mobile "Share" → app list) | Unavailable; Arciin shows Copy link instead and explains why |
| **`crypto.randomUUID`**-style browser APIs | Unavailable; Arciin uses its own fallbacks |

To get all of them, reach the server over HTTPS — enable a tunnel or reverse
proxy under **Settings → Remote access** and use that `https://` URL. Everything
else (uploads, streaming, AI, sharing by link) works fine over plain HTTP.

---

## Development

```bash
pnpm install
pnpm db:generate
pnpm dev              # web + api + worker together
```

Run processes separately:

```bash
pnpm dev:web      # Next.js on :3000
pnpm dev:api      # Fastify on :4000
pnpm dev:worker   # BullMQ consumer
```

Quality checks (same as CI):

```bash
pnpm lint
pnpm typecheck
pnpm check        # lint + typecheck + build
```

### WSL: Python on Windows, Arciin in WSL

```bash
bash scripts/examples/lib/wsl_hosts.sh
```

Set `API_BASE` in `scripts/examples/lib/arciin_client.py` to the printed WSL IP.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis for queues and realtime |
| `ARCIIN_DATA_DIR` | On-disk storage root (default `/srv/arciin-storage/arciin`, outside the repo) |
| `ARCIIN_SETUP_TOKEN` | Secret for first-run setup only |
| `ARCIIN_PUBLIC_URL` | Browser-facing URL |
| `ARCIIN_API_URL` | API origin for server-side use |
| `SESSION_SECRET` | Session signing key (32+ chars in production) |
| `NEXT_PUBLIC_API_BASE_URL` | Usually `/api` (proxied to Fastify) |
| `NEXT_PUBLIC_ARCIIN_API_ORIGIN` | Direct API URL for large uploads in dev |
| `NEXT_PUBLIC_SOCKET_URL` | Leave empty in local dev so cookies work |
| `PORT` | Web port (default 3004) |
| `API_PORT` | API port (default 4001) |
| `MAX_UPLOAD_SIZE_MB` | Max upload size (web proxy + API; default 10240) |
| `UPLOAD_RATE_LIMIT_PER_MINUTE` | Per-user upload cap per minute (default 500) |
| `LOG_MAX_FILE_BYTES` | Max size per log file before rotation (default 1800000) |

See `.env.example` for the full list.

---

## Python & API examples

Runnable scripts live in **`scripts/examples/`** — **`api/`** for REST, **`events/`** for Socket.IO. Set shared config once in `lib/arciin_client.py`.

```bash
pip install requests
# Socket.IO: pip install "python-socketio[client]" websocket-client
```

| Script | What it does |
|--------|-------------|
| `api/01_health_check.py` | Ping API health |
| `api/02_list_libraries.py` | List libraries and IDs |
| `api/04_create_folder.py` | Create a folder |
| `api/06_upload_to_library.py` | Upload to a chosen library |
| `events/01_monitor_api_key.py` | Listen for live events |

Create API keys in the app: **Developer → API Keys**.

### App data databases (JSON store)

Beyond files, Arciin exposes lightweight JSON stores backed by PostgreSQL — a
**database** holds **tables**, and a table holds **rows**. Useful for driving your
own small apps off the same server. Every new database gets a `Default` table.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` / `POST` | `/api/app-databases` | List / create databases |
| `DELETE` | `/api/app-databases/:id` | Delete a database and everything in it |
| `GET` / `POST` | `/api/app-databases/:id/tables` | List / create tables |
| `PATCH` / `DELETE` | `/api/app-database-tables/:tableId` | Rename / delete a table |
| `GET` / `POST` | `/api/app-database-tables/:tableId/rows` | List / create rows |
| `PATCH` / `DELETE` | `/api/app-database-rows/:rowId` | Update / delete a row |

Requires API-key scopes `appdata:databases:*`, `appdata:folders:*`, `appdata:records:*`
(or a signed-in session). Full copy-pasteable examples are in the in-app manual at `/docs`.

---

## Docker vs native

Both paths run the same stack (web, API, worker, Postgres, Redis, migrations, storage). See **[`docs/INSTALL-PARITY.md`](./docs/INSTALL-PARITY.md)**.

```bash
bash scripts/verify-install-parity.sh   # quick parity check
```

## Docker

Full guide: **[`docs/DOCKER.md`](./docs/DOCKER.md)** (storage bind mounts, any Linux host, troubleshooting).

**Private distribution (customers, no monorepo):** **[`docs/PRIVATE_DISTRIBUTION.md`](./docs/PRIVATE_DISTRIBUTION.md)** — image-based compose, `install-private.sh`, release tarball. Prototype only (no public registry / Stripe / license cloud yet).

### Dev / source-based compose

```bash
./scripts/docker-setup.sh
# Interactive: picks SSD path, writes .env, runs compose
```

Or manually:

```bash
cp .env.docker.example .env
# Set ARCIIN_HOST_DATA_DIR=/mnt/your-ssd/arciin-data
# Set ARCIIN_SETUP_TOKEN, SESSION_SECRET, ARCIIN_PUBLIC_URL

export ARCIIN_HOST_DATA_DIR=/mnt/your-ssd/arciin-data
docker compose up --build -d
```

### Production images (local prototype)

```bash
pnpm docker:build          # tag arciin/arciin-{web,api,worker}:latest
pnpm docker:up             # docker-compose.production.yml (images only)
pnpm docker:logs
pnpm docker:down
pnpm docker:package        # dist/arciin-private-release.tar.gz (no source)
pnpm docker:install-private  # install into /srv/arciin + storage
```

Open **http://localhost** (Caddy on port 80). Your files live on disk at **`ARCIIN_HOST_DATA_DIR`**, not inside the container.

---

## Project layout

```text
arciin/
├── apps/
│   ├── web/                # Next.js App Router (UI)
│   ├── api/                # Fastify REST + Socket.IO + chat tools
│   └── worker/             # BullMQ jobs (thumbnails, metadata)
├── packages/
│   ├── types/              # Shared TypeScript types and events
│   ├── config/             # Constants, env schemas, defaults
│   ├── storage/            # Storage paths, layout, migration
│   ├── ui/                 # Shared UI tokens and utilities
│   ├── database/           # Prisma client wrapper (API + worker only)
│   └── shared/             # Domain helpers + compatibility barrel
├── prisma/                 # Schema and migrations (server only)
├── scripts/
│   ├── examples/           # Python integration examples
│   ├── start.sh            # Start all PM2 processes
│   └── stop.sh             # Stop all PM2 processes
├── docker/                 # Caddy config and helpers
├── docker-compose.yml      # Source-based compose (dev / clone install)
├── docker-compose.production.yml  # Image-based private distribution
├── .env.production.example
└── install.sh              # Server install (web + api + worker + DB)
```

---

## Tech stack

**Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, Zustand, Socket.IO client, Framer Motion

**Backend:** Fastify, Prisma, PostgreSQL, Redis, BullMQ, Socket.IO, Sharp, FFmpeg, pdf.js (text extraction)

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) | Day-to-day dev workflow |
| [`docs/DOCKER.md`](./docs/DOCKER.md) | Docker on any Linux host, SSD bind mounts |
| [`docs/PRIVATE_DISTRIBUTION.md`](./docs/PRIVATE_DISTRIBUTION.md) | Image-based install without monorepo (prototype) |
| [`docs/LICENSE_SERVER.md`](./docs/LICENSE_SERVER.md) | Hosted license server prototype (no Stripe) |
| [`docs/ACCOUNT_DASHBOARD.md`](./docs/ACCOUNT_DASHBOARD.md) | Account portal prototype (account.arciin.com) |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Production and self-hosting |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System design |
| [`docs/API.md`](./docs/API.md) | API overview |
| [`docs/THIRD_PARTY_NOTICES.md`](./docs/THIRD_PARTY_NOTICES.md) | Open-source licenses, fonts, brand icon attribution |
| In-app **Documentation** | Full REST manual at `/docs` when running |

Also see [`AGENTS.md`](./AGENTS.md) for contributor conventions.

---

## License

Arciin is **proprietary** software. See [`LICENSE`](./LICENSE) for full terms.

You may install and run Arciin on servers you own or control. Redistribution, sublicensing, and multi-tenant SaaS resale require separate permission.

Third-party open-source components and brand icon attributions are documented in [`docs/THIRD_PARTY_NOTICES.md`](./docs/THIRD_PARTY_NOTICES.md).

---

<p align="center">
  <strong>Arciin</strong> — built for the server you own.<br />
  Companion app: <a href="https://github.com/Roberadesissaii-arc/arciin-app">Arciin Mobile</a>
</p>
