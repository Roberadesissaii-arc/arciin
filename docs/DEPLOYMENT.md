# Deployment

For **Docker on Raspberry Pi**, SSD bind mounts, and “held broken packages” on apt, read **[DOCKER.md](./DOCKER.md)** first.

Arciin ships with Docker assets for a local-first self-hosted deployment:

- `Dockerfile.web`
- `Dockerfile.api`
- `Dockerfile.worker`
- `docker-compose.yml`
- `docker/caddy/Caddyfile`

## Compose flow

1. Run the setup script (recommended):

```bash
./scripts/docker-setup.sh
```

Or copy the Docker env template:

```bash
cp .env.docker.example .env
```

2. Update at least:

- `ARCIIN_HOST_DATA_DIR` — folder on your **host** SSD/HDD (bind mount)
- `ARCIIN_SETUP_TOKEN`
- `SESSION_SECRET`
- `ARCIIN_PUBLIC_URL` — `http://localhost` or `http://<lan-ip>`

3. Start the stack:

```bash
export ARCIIN_HOST_DATA_DIR=/path/on/host   # must match .env
docker compose up --build -d
```

4. Open `http://localhost/setup?token=<ARCIIN_SETUP_TOKEN>`

## Services

The compose file provisions:

- `caddy`
- `web`
- `api`
- `worker`
- `postgres`
- `redis`

Persistent volumes:

- `postgres_data` — database files
- `redis_data` — queue/cache

Media and uploads use a **bind mount** (not a named Docker volume):

- Host: `ARCIIN_HOST_DATA_DIR` (e.g. `/mnt/nvme/arciin-data`)
- Container: `/data/arciin` on `api` and `worker`

## Reverse proxy

Caddy handles:

- `/api/*` -> `api:4000`
- `/socket.io/*` -> `api:4000`
- everything else -> `web:3000`

## Storage

The API and worker mount the same persistent storage volume at:

```txt
/data/arciin
```

That root contains:

```txt
/objects
/libraries
/thumbnails
/temp
/logs
```

## Production notes

- Replace the example database and Redis credentials.
- Put Caddy behind your preferred DNS, reverse proxy, or tunnel setup.
- Set `ARCIIN_PUBLIC_URL` to the externally reachable URL.
- Keep `SESSION_SECRET` and `ARCIIN_SETUP_TOKEN` out of version control.
- FFmpeg is optional but recommended for richer video processing.
- Run `pnpm check` on the release branch before deploying images.

## Preflight checklist

```bash
pnpm check
bash -n install.sh scripts/arciin-init.sh scripts/entrypoint-api.sh
```

Bare-metal install (Debian/Ubuntu/WSL):

```bash
./install.sh
pnpm dev
# open the setup URL printed at the end
```

Docker:

```bash
./scripts/docker-setup.sh
# or: cp .env.docker.example .env && docker compose up --build -d
# open http://localhost/setup?token=<ARCIIN_SETUP_TOKEN>
```

Socket.IO and uploads behind Caddy use the **browser origin** when `NEXT_PUBLIC_SOCKET_URL` is empty — do not point the UI at `:4000` unless that port is published.

## Prisma in containers

The API image runs `pnpm db:generate` during build. On container start, `scripts/entrypoint-api.sh` runs `prisma migrate deploy`, seeds defaults, creates storage directories, then starts the API. No manual migration step is required after `docker compose up`.

To re-run initialization manually:

```bash
docker compose exec api pnpm db:init
```
