# Arciin

**Your server, your control.**

Arciin is a self-hosted private file, library, and media management platform. The current repository is application-first: the setup flow, local authentication, dashboard shell, API, worker, uploads, settings, and self-hosted deployment assets all live here. The public marketing site is intentionally not the priority yet.

## What is here

- Next.js 16 web app in the repository root
- Fastify API in `apps/api`
- BullMQ worker in `apps/worker`
- Prisma schema in `prisma`
- shared workspace packages in `packages/`
- Docker Compose and Caddy assets for local-first deployment

## Core flows

- root route redirects to `/setup`, `/login`, or `/dashboard`
- first-run instance claim with setup token
- local email/password authentication with httpOnly sessions
- dashboard shell with grouped sidebar navigation
- libraries, folders, assets, and upload history
- global drag-and-drop upload overlay and queue
- Socket.IO-backed realtime updates
- API keys, storage settings, remote access settings, and integrations placeholder

## Default libraries

- Videos
- Images
- Music
- Documents
- Inbox

## Tech stack

### Frontend

- Next.js App Router
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui
- TanStack Query
- Zustand
- Framer Motion
- Sonner
- React Hook Form
- Zod

### Backend

- Fastify
- Prisma
- PostgreSQL
- Redis
- BullMQ
- Socket.IO
- Sharp
- FFmpeg / ffprobe

## Development

```bash
./install.sh
pnpm db:migrate
pnpm dev
```

Optional installer flags:

```bash
ARCIIN_UPGRADE_SYSTEM=1 ./install.sh
ARCIIN_RUN_MIGRATIONS=1 ./install.sh
ARCIIN_MIGRATION_NAME=my-local-change ARCIIN_RUN_MIGRATIONS=1 ./install.sh
```

Individual processes:

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

Verification:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Environment

Copy `.env.example` to `.env` and update:

- `DATABASE_URL`
- `REDIS_URL`
- `ARCIIN_SETUP_TOKEN`
- `SESSION_SECRET`
- `ARCIIN_PUBLIC_URL`

## Docker

The repository includes:

- `Dockerfile.web`
- `Dockerfile.api`
- `Dockerfile.worker`
- `docker-compose.yml`
- `docker/caddy/Caddyfile`

Basic flow:

```bash
cp .env.example .env
docker compose up --build -d
```

Open `http://localhost`.

## Docs

- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/DEPLOYMENT.md`
- `docs/API.md`

## Current emphasis

Arciin is being built as a real self-hosted application first. The next iteration after this milestone is refinement: improving the processing pipeline, asset previews, user management, and deployment polish.
