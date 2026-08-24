# Development

## Requirements

- Node.js 20
- pnpm 10
- PostgreSQL
- Redis
- FFmpeg / ffprobe for richer media processing

## Install

```bash
pnpm install
cp .env.example .env
```

Update `.env` so `DATABASE_URL`, `REDIS_URL`, and `ARCIIN_SETUP_TOKEN` point to local services.

## Prisma

Generate the client:

```bash
pnpm db:generate
```

Apply a migration against your local database:

```bash
pnpm db:migrate
```

Optional seed pass:

```bash
pnpm db:seed
```

## Run the stack

Run all three development processes together:

```bash
pnpm dev
```

Or run them independently:

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

Default local ports:

- web: `3000`
- api: `4000`
- postgres: `5432`
- redis: `6379`

## Verification

Use the narrowest useful checks first:

```bash
pnpm db:generate
pnpm typecheck
pnpm lint
pnpm build
```

## First-run flow

With the web and API running:

1. Open `http://localhost:3100`
2. You should be redirected to `/setup`
3. Use `ARCIIN_SETUP_TOKEN` to claim the instance
4. Create the owner account
5. Land in `/dashboard`

## Useful paths

- `http://localhost:3100/setup`
- `http://localhost:3100/login`
- `http://localhost:3100/dashboard`
- `http://localhost:4000/api/health`

## Notes

- The root web app proxies browser `/api/*` requests to the Fastify API through `next.config.ts`.
- Server-rendered route guards use `ARCIIN_API_URL`, so the web app must be able to reach the API from the server environment too.
- Socket.IO defaults to the current browser origin unless `NEXT_PUBLIC_SOCKET_URL` is set.
