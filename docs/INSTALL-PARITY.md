# Docker vs native install parity

Arciin supports two production install paths. Both run the **same application** (web, API, worker, PostgreSQL, Redis); only packaging differs.

| Capability | Native (`./install.sh`) | Docker (`./install.sh --docker` or `scripts/docker-setup.sh`) |
|------------|-------------------------|------------------------------------------------------------------|
| Web UI | PM2 `arciin-web` (port from `.env`, default 3004) | Container `web` behind Caddy on **:80** |
| API | PM2 `arciin-api` (loopback, default 4001) | Container `api` (:4000 internal) |
| Worker | PM2 `arciin-worker` | Container `worker` |
| PostgreSQL | Host `apt` install | Container `postgres` |
| Redis | Host `apt` install | Container `redis` |
| DB migrations + seed | `scripts/arciin-init.sh` during install | Same script in API container entrypoint |
| File storage | `ARCIIN_DATA_DIR` on host (default `/srv/arciin-storage/arciin`) | `ARCIIN_HOST_DATA_DIR` bind-mounted to `/data/arciin` |
| Setup token / session secret | Auto-generated in `.env` if missing | Same |
| Upload limit, rate limit, logs env | `.env.example` keys | `.env.docker.example` (same keys) |
| Mobile pairing, chat, PDF preview, API keys | Yes | Yes |
| Cloudflare quick tunnel | `cloudflared` on host (optional apt) | `cloudflared` in API image |

## Verify locally

```bash
bash scripts/verify-install-parity.sh
```

If the UI loads but `/api/*` returns **502**, the API process is down (Docker: `bash scripts/docker-doctor.sh`; see `docs/DOCKER.md` troubleshooting).

## Environment files

- **Native:** copy `.env.example` → `.env` (or let `install.sh` create it).
- **Docker:** copy `.env.docker.example` → `.env` (or use `docker-setup.sh`).

Compose injects `DATABASE_URL` and `REDIS_URL` for containers; do not point those at `localhost` inside Docker.

## After code updates

**Native:**

```bash
git pull && pnpm install && pnpm exec prisma migrate deploy && pnpm build
pm2 restart arciin-api arciin-web arciin-worker
```

**Docker:**

```bash
git pull
export ARCIIN_HOST_DATA_DIR=/your/storage/path   # from .env
docker compose --env-file .env up --build -d
```

Data in `ARCIIN_HOST_DATA_DIR` / `ARCIIN_DATA_DIR` is preserved across rebuilds.
