# Native vs production Docker install parity

Arciin ships two supported install models:

- **Native:** `install.sh` + PM2 (`arciin-web`, `arciin-api`, `arciin-worker`) + host PostgreSQL/Redis
- **Production Docker:** `scripts/docker-install.sh` on `docker-compose.production.yml` (Caddy, web, api, worker, postgres, redis). The one-liner, `./install.sh --docker` and `./scripts/docker-setup.sh` all run that installer.

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
| Worker health includes the DB | `heartbeat:db` written after `SELECT 1` | same probe in the worker healthcheck |
| Starts after reboot | `pm2-<user>` enabled + saved list, verified | Docker enabled at boot + `restart: unless-stopped`, verified |
| Never destructive by default | repair is the default; erase needs `ERASE ARCIIN` | same |
| Backup before repair | `pg_dump -Fc` → `<storage>/backups/repair-*` | same, from the postgres container |
| Credentials tested, not assumed | real login with `.env`; drifted role re-aligned | network login from a separate container; recovery from containers/backups, or re-key |
| State classifier + journal | `scripts/lib/install-state.sh`, `~/.local/state/arciin/install-state.json` | same library, `/opt/arciin/install-state.json` |
| Errors | What / Why / Your data / How to recover | same (`arciin_fail_report`) |
| Storage checks | unmounted-disk refusal + write test | same, as the containers' uid |
| Licensing preflight | `scripts/license-preflight.mjs` | same, inside the API container |
| Diagnosis | `scripts/arciin-doctor.sh` | `/opt/arciin/arciin-doctor.sh` |

## Intentional differences

These are **not** parity failures:

- **Ports:** native binds host `ARCIIN_WEB_PORT` / `API_PORT`; production Docker publishes Caddy `:80` (or `ARCIIN_HTTP_PORT`) and keeps API on the compose network.
- **Reverse proxy:** production uses Caddy in-compose; native may use none, Caddy, or another host proxy.
- **Process manager:** PM2 vs `docker compose`.
- **Storage path:** host `/srv/arciin-storage/arciin` vs container `/data/arciin` (same data via bind mount).
- **Development compose** (`docker-compose.yml`) is a source-bind prototype and is **not** the production contract.
- **LAN mDNS:** both native and Docker installers call the same host helper (`scripts/lib/avahi-discovery.sh`). Avahi stays on the host. Failure is non-fatal.
- **Firewall:** native opens its web/API ports; Docker leaves the host firewall alone because Docker publishes ports through its own iptables chain.
- **Images vs build:** Docker pulls published images pinned by digest; native builds from the checkout (and reuses the build when nothing changed).

## Drift

The verifier fails (nonzero) when a required production/native assumption is missing: service, healthcheck, restart policy, storage mount, migration entrypoint, required environment variable — or when an installer path drifts: a Docker entry point that no longer reaches `docker-install.sh`, a `:latest` image default, or an installer that lost the shared state library, journal, four-part errors, typed erase confirmation, pre-repair backup, storage mount check or licensing preflight.

The end-to-end proof is behavioural, not textual: `.github/workflows/install-docker.yml` and `.github/workflows/install-vm.yml` (disposable LXD VMs, real reboots) run the scenarios in `tests/install/`.
