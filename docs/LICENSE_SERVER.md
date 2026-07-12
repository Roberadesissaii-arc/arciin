# Hosted license server prototype

Future home: **license.arciin.com**. This monorepo app is the foundation — **no Stripe**, no billing, manual/demo license creation only.

## Architecture

```text
Demo portal / Settings → License
        │
        ▼
Self-hosted Arciin API  ──HTTP──►  apps/license-server (:4100)
        │                               │
        │  stores signed token          │ Customer / License / Activation
        │  verifies HMAC locally        │ signs arclic.v2 tokens
        ▼                               ▼
  Premium feature gates            SQLite (or Postgres later)
  Free core always on
```

| Component | Role |
|-----------|------|
| `apps/license-server` | Issue keys, activate, refresh, deactivate, status |
| `ARCIIN_LICENSE_SERVER_URL` | Self-hosted API → license server base URL |
| `LICENSE_SIGNING_SECRET` / `ARCIIN_LICENSE_VERIFY_SECRET` | Shared HMAC secret for tokens |
| Settings → License | Paste key → activate → store token |
| `/demo/licenses` | Create demo licenses via license server |

## Data model

- **Customer** — name, email  
- **License** — keyPrefix, keyHash, plan, status, serverLimit, expiresAt, graceDays  
- **Activation** — instanceId, instanceName, version, hostname, lastCheckInAt, deactivatedAt  

Full key is shown **once** at creation; only the hash is stored.

## API (license server)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/licenses/demo` | Create Free/Pro/Team/Business demo license |
| `POST` | `/licenses/activate` | Bind key to instanceId; return signed token |
| `POST` | `/licenses/refresh` | Update lastCheckInAt; return latest token |
| `POST` | `/licenses/deactivate` | Release this instance slot |
| `GET` | `/licenses/status` | License + activations |
| `POST` | `/licenses/revoke` | Mark license revoked (demo secret) |
| `GET` | `/health` | Liveness |

### Signed token (`arclic.v2`)

Includes: `licenseId`, `plan`, `status`, `instanceId`, `features`, `serverLimit`, `issuedAt`, `expiresAt`, `graceUntil`, `activationId`, `keyPrefix`.

Self-hosted instances **verify** the token with `ARCIIN_LICENSE_VERIFY_SECRET` (must match `LICENSE_SIGNING_SECRET`).

## Self-hosted routes (proxy)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/license/status` | Local snapshot + `licenseServerConfigured` |
| `POST` | `/license/activate` | Hosted first; mock fallback if allowed |
| `POST` | `/license/refresh` | Online refresh; offline keeps token until grace |
| `POST` | `/license/deactivate` | Clears local + notifies server |
| `POST` | `/license/demo` | Proxy demo key creation |
| `GET` | `/license/hosted-status` | Proxy status for demo portal |

## Local setup

```bash
# 1. Install + create SQLite schema
pnpm install
pnpm license-server:db

# 2. Env (repo root .env)
ARCIIN_LICENSE_SERVER_URL=http://127.0.0.1:4100
ARCIIN_LICENSE_VERIFY_SECRET=arciin-dev-license-signing-secret-change-me

# apps/license-server/.env (optional overrides)
LICENSE_SIGNING_SECRET=arciin-dev-license-signing-secret-change-me
LICENSE_SERVER_PORT=4100

# 3. Run license server
pnpm license-server
# or: pnpm license-server:dev

# 4. Run Arciin as usual
pnpm dev
# or all together: pnpm dev:all
```

## Failure / offline behavior

| Situation | Behavior |
|-----------|----------|
| License server down on **activate** | Error (or local mock key if `ARCIIN_LICENSE_DEV_FALLBACK`) |
| Server down on **refresh** | Keep stored signed token; evaluate local grace |
| Token expired + within grace | Premium still on (`grace`) |
| After grace / revoked on refresh | Premium off; **files/libraries/uploads stay free** |
| Deactivate | Free core; files untouched |

## Dev fallback

- `ARCIIN_LICENSE_DEV_FALLBACK` default: **true** in development, **false** in production when unset after schema default logic.
- Local keys: `ARCIIN-DEV-PRO`, `arc_demo_*` client-generated strings (only if fallback path used).
- Hosted demo keys: `arc_demo_{plan}_{hex}` issued by the server.

## Test checklist

- [ ] `pnpm license-server` + health `GET :4100/health`
- [ ] Demo portal → Generate Pro → key returned from hosted server
- [ ] Settings → License → activate → Pro features unlock
- [ ] Refresh → activation `lastCheckInAt` updates (View activations)
- [ ] Deactivate → premium locks; files still open
- [ ] Server limit: Team limit 3 — 4th instance rejected
- [ ] Revoke key (`POST /licenses/revoke`) → refresh on instance → premium off
- [ ] Stop license server → refresh keeps grace/active token offline
- [ ] Files/libraries/uploads never locked

## Out of scope (later)

- Stripe checkout  
- Customer account dashboard (real arciin.com)  
- Public multi-tenant auth on license.arciin.com  
- Asymmetric signing (currently shared HMAC)

## Related

- Account portal: [`ACCOUNT_DASHBOARD.md`](./ACCOUNT_DASHBOARD.md) (`pnpm account` → :3010)

## Roadmap position

```text
1. Local license gates
2. Soft-lock UI
3. Demo portal → account dashboard
4. Docker private distribution
5. Hosted license server prototype
6. Account dashboard prototype  ← apps/account
7. Stripe checkout (later)
8. Update server
9. Backup add-on
```

