# Deployment

Arciin ships with Docker assets for a local-first self-hosted deployment:

- `Dockerfile.web`
- `Dockerfile.api`
- `Dockerfile.worker`
- `docker-compose.yml`
- `docker/caddy/Caddyfile`

## Compose flow

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Update at least:

- `ARCIIN_SETUP_TOKEN`
- `SESSION_SECRET`
- `ARCIIN_PUBLIC_URL`

3. Start the stack:

```bash
docker compose up --build -d
```

4. Open `http://localhost`

## Services

The compose file provisions:

- `caddy`
- `web`
- `api`
- `worker`
- `postgres`
- `redis`

Persistent volumes:

- `postgres_data`
- `redis_data`
- `arciin_data`

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

## Prisma in containers

The API and worker images run `pnpm db:generate` during image build.

Run migrations after the database is reachable:

```bash
docker compose exec api pnpm db:migrate
```
