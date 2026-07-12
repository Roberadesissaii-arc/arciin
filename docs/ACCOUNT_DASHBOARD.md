# Account dashboard prototype

Future home: **account.arciin.com**. Separate from the self-hosted Arciin app.

**No Stripe. No billing.** Demo licenses only, backed by the hosted license server.

## What it is

| Path | Purpose |
|------|---------|
| `/account` | Overview — customer, plan, servers, quick actions |
| `/account/licenses` | Create / copy / revoke licenses; view activations |
| `/account/servers` | Activated instances; deactivate server |
| `/account/downloads` | Install command, Docker steps, requirements |

Monorepo app: `apps/account` (Next.js on **port 3010**).

## Architecture

```text
Browser → apps/account (:3010)
              │
              ▼ server actions / fetch
         apps/license-server (:4100)
              │
              ▼
         SQLite Customer / License / Activation

Self-hosted apps/web Settings → License
              │
              ▼ activate key
         apps/api → license-server
```

## Run locally

```bash
# Terminal A — license API
pnpm license-server:db   # once after schema changes
pnpm license-server

# Terminal B — account portal
pnpm account
# → http://localhost:3010/account

# Terminal C — self-hosted instance
pnpm dev
```

Or: `pnpm dev:all` (web, api, worker, license-server, account).

### Env

```bash
# Root .env (self-hosted API + web links)
ARCIIN_LICENSE_SERVER_URL=http://127.0.0.1:4100
ARCIIN_LICENSE_VERIFY_SECRET=arciin-dev-license-signing-secret-change-me
NEXT_PUBLIC_ARCIIN_ACCOUNT_URL=http://localhost:3010/account

# apps/account/.env (optional)
LICENSE_SERVER_URL=http://127.0.0.1:4100
```

## License server account APIs

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/account/overview?email=` | Customer + licenses + activations |
| `GET` | `/account/licenses?email=` | License list |
| `GET` | `/account/activations?email=` | Server activations |
| `POST` | `/account/deactivate-server` | Free a server slot |
| `POST` | `/licenses/demo` | Create Free/Pro/Team/Business key |
| `POST` | `/licenses/revoke` | By key or licenseId |

Demo customer email default: `you@yourserver.com`.

## Self-hosted links

- Settings → License → **Open Arciin account**
- Soft-lock / plan gates → **Manage license** / **Open Arciin account**
- Old `/demo/licenses` soft-redirects to the account portal

## Test checklist

- [ ] `pnpm license-server` + `pnpm account` running
- [ ] Create Pro license in account → Licenses
- [ ] Copy full key (demo mode)
- [ ] Paste into self-hosted Settings → License → Activate
- [ ] Pro features unlock on instance
- [ ] Account → Servers shows instance; last check-in after Refresh
- [ ] Revoke license in account → Refresh on instance → premium off
- [ ] Files / libraries / uploads still work after revoke
- [ ] Deactivate server frees slot for another activation
- [ ] Banner shows “Demo mode — billing is not connected yet.”

## Roadmap

```text
1. Account dashboard prototype          ← this doc
2. Harden license server + auth later
3. Install / download production flow
4. Stripe checkout → create/update license
5. Real billing / customer portal
6. Update server
7. Backup add-on
```
