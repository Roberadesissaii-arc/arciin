# Private distribution prototype

Goal: customers **install and run Arciin without cloning the monorepo**.

This is a packaging prototype. It does **not** include Stripe, a real license cloud, or public image publishing.

---

## Product flow (intended)

```text
Before (developer / open-style):
  git clone monorepo → docker compose build → run source

After (private self-hosted product):
  run install.sh → pull production images → use Arciin
```

| Customer receives | Customer does **not** receive |
|-------------------|-------------------------------|
| `docker-compose.yml` (image-based) | Full monorepo / apps / packages |
| `.env` template | Editable TypeScript source |
| `install.sh` | Private registry credentials (later) |
| Caddyfile | Stripe / billing UI (later) |
| Production images (`web`, `api`, `worker`) | Real license cloud (later) |

---

## Architecture

```text
Browser
   │
   ▼
Caddy :80 ──► arciin-web (Next.js image)
          ──► /api, /socket.io → arciin-api (Fastify image)
api + worker ── bind mount ──► /srv/arciin-storage/arciin (host)
api + worker ──► postgres, redis (Compose)
```

- **Config** lives under `/srv/arciin` (compose + `.env`).
- **Media / libraries** live under `/srv/arciin-storage/arciin` (host bind mount).
- **Updates** later: `docker compose pull && docker compose up -d` — no source pull.

---

## Files in this monorepo

| Path | Role |
|------|------|
| `docker-compose.production.yml` | Image-based stack (web, api, worker, postgres, redis, caddy) |
| `.env.production.example` | Env template (no secrets) |
| `scripts/docker-build-images.sh` | Build + tag local production images |
| `scripts/install-private.sh` | Installer prototype → `/srv/arciin` + storage |
| `scripts/package-private-release.sh` | Build customer tarball under `dist/` |
| `docker/caddy/Caddyfile` | Reverse proxy (copied into install dir) |
| `docs/PRIVATE_DISTRIBUTION.md` | This document |

Existing **source-based** path remains for development:

- `docker-compose.yml` + `./scripts/docker-setup.sh` / `./install.sh --docker`

---

## Developer: build images locally

From the monorepo root (requires Docker + full source):

```bash
pnpm docker:build
# or: ./scripts/docker-build-images.sh
# or single service: ./scripts/docker-build-images.sh api
```

Tags:

- `arciin/arciin-web:latest`
- `arciin/arciin-api:latest`
- `arciin/arciin-worker:latest`

Override:

```bash
ARCIIN_IMAGE_TAG=0.1.0-dev pnpm docker:build
```

**Do not push these publicly yet.** Private registry comes later.

---

## Developer: run production compose against local images

```bash
# One-time secrets if you do not use the private installer
cp .env.production.example .env
# fill POSTGRES_PASSWORD, REDIS_PASSWORD, SESSION_SECRET, ARCIIN_SETUP_TOKEN, …

pnpm docker:build
pnpm docker:up
pnpm docker:logs
pnpm docker:down
```

`docker:up` uses `docker-compose.production.yml` and does **not** rebuild from source on each start.

---

## Customer: install without source

### Option A — release bundle

```bash
# On a machine that has the monorepo (maintainer):
pnpm docker:package

# Ship dist/arciin-private-release.tar.gz to the customer (plus images later)
# Customer:
tar -xzf arciin-private-release.tar.gz
cd arciin-private-release
chmod +x install.sh
./install.sh
```

### Option B — monorepo helper (prototype only)

```bash
./scripts/install-private.sh
# installs into /srv/arciin and /srv/arciin-storage/arciin
# builds images if pull is unavailable and monorepo is present
```

Installer steps:

1. Create `/srv/arciin` and `/srv/arciin-storage/arciin`
2. Copy production compose + Caddyfile into `/srv/arciin`
3. Copy env template → `.env` if missing
4. Generate `SESSION_SECRET`, setup token, encryption key, DB/Redis passwords
5. `docker compose pull` (or use pre-built local images)
6. `docker compose up -d`
7. Print local URL + Settings → License next steps

Environment:

| Variable | Meaning |
|----------|---------|
| `ARCIIN_INSTALL_DIR` | Config dir (default `/srv/arciin`) |
| `ARCIIN_HOST_DATA_DIR` | Storage bind mount (default `/srv/arciin-storage/arciin`) |
| `ARCIIN_SKIP_PULL=1` | Skip registry pull; use local image tags |

---

## Free core + license (must keep working)

After Docker private install:

| Behavior | Expected |
|----------|----------|
| Files / libraries / uploads | Work on free plan |
| Free plan | Default when no license / free license |
| Demo activation | `ARCIIN-DEV-PRO`, `arc_demo_pro_…`, etc. unlock paid UI |
| Deactivate | Paid features soft-lock again |
| Files never locked | Core storage always available |
| Migrations | API entrypoint runs `prisma migrate deploy` on start |
| Storage after restart | Host bind mount persists |

No Stripe and no remote license server for this prototype — keys are validated on-instance (demo/mock).

---

## Test checklist

Use a clean Linux host (or wipe `/srv/arciin` + containers carefully).

### Install

- [ ] Docker Engine + Compose available
- [ ] Images built (`pnpm docker:build`) or loadable
- [ ] `./scripts/install-private.sh` (or release `install.sh`) completes
- [ ] `/srv/arciin` contains `docker-compose.yml`, `.env`, `docker/caddy/Caddyfile`
- [ ] `/srv/arciin-storage/arciin` exists and is writable by container uid

### Stack

- [ ] `docker compose ps` — web, api, worker, postgres, redis, caddy up
- [ ] Web opens at `http://localhost` (or `ARCIIN_HTTP_PORT`)
- [ ] API health: `curl -sS http://localhost/api/health` OK
- [ ] Worker running (no crash loop in `docker compose logs worker`)
- [ ] Postgres healthy; migrations applied (`docker compose logs api` shows arciin-init)
- [ ] Redis healthy

### Product

- [ ] First-run setup with `ARCIIN_SETUP_TOKEN`
- [ ] Upload a file — appears in library / All Files
- [ ] Free plan: core UI works; paid features soft-locked where expected
- [ ] Settings → License status loads
- [ ] Activate `ARCIIN-DEV-PRO` (or demo portal key) — paid UI unlocks
- [ ] Deactivate — paid features lock again
- [ ] Files still accessible after deactivate

### Persistence

- [ ] `docker compose restart` (or `down` + `up -d`)
- [ ] Uploaded file still present under `/srv/arciin-storage/arciin`
- [ ] License status unchanged (DB volume intact)

### Distribution integrity

- [ ] Customer bundle under `dist/arciin-private-release` has **no** `apps/`, `packages/`, or `prisma/` source tree
- [ ] Production compose has **no** `build: context` for web/api/worker (images only)

---

## Roadmap after this prototype

```text
1. Docker / private distribution prototype   ← you are here
2. Real hosted license server
3. Stripe checkout + account dashboard
4. Update server (signed image channels)
5. Backup add-on
```

---

## Related docs

- [DOCKER.md](./DOCKER.md) — source-based Docker / bind mounts (dev & `install.sh --docker`)
- [DEPLOYMENT.md](./DEPLOYMENT.md) — general deployment notes
