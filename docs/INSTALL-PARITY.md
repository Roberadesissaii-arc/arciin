# Native vs production Docker install parity

Arciin ships two supported install models:

- **Native:** `install.sh` + PM2 (`arciin-web`, `arciin-api`, `arciin-worker`) + host PostgreSQL/Redis
- **Production Docker:** `docker-compose.production.yml` (Caddy, web, api, worker, postgres, redis)

They do not need to be byte-identical. They must satisfy the same **functional contract**.

The verifier is `scripts/verify-install-parity.sh`.

## Shared contract

Both models must provide:

| Capability | Native | Production Docker |
|---|---|---|
| Web UI | PM2 `arciin-web` | `web` image |
| API | PM2 `arciin-api` / `apps/api/dist/index.js` | `api` image |
| Worker | PM2 `arciin-worker` / `apps/worker/dist/index.js` | `worker` image |
| PostgreSQL | host `postgresql` | `postgres` service |
| Redis | host `redis` | `redis` service |
| Schema migrations | `scripts/arciin-init.sh` | API entrypoint → `arciin-init.sh` |
| File storage | `ARCIIN_DATA_DIR` (host path, default `/srv/arciin-storage/arciin`) | bind mount `ARCIIN_HOST_DATA_DIR` → `/data/arciin` |
| Licensing | `ARCIIN_LICENSE_PUBLIC_KEYS` / hosted activate | same env on api/worker |
| Worker jobs | BullMQ on Redis | same |
| Health / readiness | `/api/health`, `/api/health/live` | compose healthchecks calling those endpoints |
| Worker health | `scripts/worker-healthcheck.mjs` | worker healthcheck |
| Media runtime | host ffmpeg/ffprobe (install.sh) | baked into worker/api images |
| Required secrets | `ARCIIN_SETUP_TOKEN`, `SESSION_SECRET`, `DATABASE_URL` | plus `POSTGRES_PASSWORD`, `REDIS_PASSWORD` |
| Security defaults | setup token, hashed sessions, no public signup | `no-new-privileges`, dropped caps, required DB/Redis passwords |

## Intentional differences

These are **not** parity failures:

- **Ports:** native binds host `ARCIIN_WEB_PORT` / `API_PORT`; production Docker publishes Caddy `:80` (or `ARCIIN_HTTP_PORT`) and keeps API on the compose network.
- **Reverse proxy:** production uses Caddy in-compose; native may use none, Caddy, or another host proxy.
- **Process manager:** PM2 vs `docker compose`.
- **Storage path:** host `/srv/arciin-storage/arciin` vs container `/data/arciin` (same data via bind mount).
- **Development compose** (`docker-compose.yml`) is a source-bind prototype and is **not** the production contract.
- **LAN mDNS:** both native and Docker installers call the same host helper (`scripts/lib/avahi-discovery.sh`). Avahi stays on the host. Failure is non-fatal.

## Drift

The verifier fails (nonzero) when a required production/native assumption is missing: service, healthcheck, storage mount, migration entrypoint, or required environment variable.
