# Production checklist for public self-hosted Arciin

Anyone who installs Arciin on their own machine owns that **instance**. This document is for operators shipping a real server strangers can install safely.

## Threat model (instance)

| Trust | Meaning |
|--------|---------|
| **Host owner** | Controls the OS, disk, Postgres, Redis, and `.env` |
| **Instance owner** | First claim user (`OWNER`) — only person who can admin until they invite others |
| **LAN / internet users** | Untrusted until authenticated |

Arciin is **not** multi-tenant SaaS. One install = one private server. Security depends on:

1. Strong secrets generated at install
2. Setup locked after first claim
3. Public signup **off** by default
4. Rate limits + IP controls
5. Keeping Postgres/Redis on localhost (or private network)

## Installer guarantees

| Item | Behavior |
|------|----------|
| `ARCIIN_SETUP_TOKEN` | Random on first install (not `dev-token`) |
| `SESSION_SECRET` | Random on first install |
| `ARCIIN_ENCRYPTION_KEY` | Random on fresh native/Docker install |
| Docker `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | Random when still placeholders |
| Production API boot | **Refuses** weak `SESSION_SECRET` or `ARCIIN_SETUP_TOKEN` |
| Public registration | **Disabled** unless an OWNER enables it |
| First claim | Requires setup token; creates sole OWNER; cannot re-claim |

## After install (operator)

1. Open only `http://HOST:3000` (or your reverse proxy HTTPS URL).
2. Complete `/setup?token=…` once — store the owner password offline.
3. Prefer **HTTPS** (Caddy/nginx/Cloudflare Tunnel) if reachable from the internet.
4. Do **not** expose Postgres (`5432`) or Redis (`6379`) to the public internet.
5. Rotate any token that was pasted in chat logs or screenshots.
6. Optional: Settings → Security → IP allowlist for admin-only networks.

## Supported production paths

| Path | Audience |
|------|----------|
| **Docker** (`./install.sh --docker` / `docker-setup.sh`) | Recommended for most hosts |
| **Native Linux / WSL** (`./install.sh`) | Bare metal / existing Postgres+Redis |
| **Windows Desktop** | Docker Desktop or WSL — not bare CMD |

## What “ready for strangers” means

Strangers can:

- Clone/download, run the installer, claim **their** instance, use the product

Strangers cannot (by default):

- Sign up on **your** already-claimed instance without invitation / public signup
- Re-claim a locked instance without wiping the DB
- Call authenticated APIs without a session or API key

## Verify before you announce a release

```bash
pnpm typecheck
pnpm lint          # 0 errors
pnpm test
pnpm build
# CI + Docker workflows green on main
```

Then on a clean machine: install → setup → login → upload a file → logout.
