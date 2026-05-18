# Arciin mobile PWA — client build spec

Build a **standalone mobile PWA** that connects to an existing **Arciin server** (this repo). The server side is already implemented; your job is only the mobile client.

## Server capabilities (already live)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/mobile/discover` | None | Instance metadata + URLs |
| `POST /api/mobile/pair/verify` | None | Validate 6-digit code before login |
| `POST /api/mobile/pair` | None | Code + email + password → session |
| `GET /api/settings/mobile-connection` | Admin session | (Web UI only) |

Admin generates a **6-digit code** in **Settings → Mobile connection** (10 min TTL, single use).

## Onboarding flow (implement in order)

1. **Welcome** — “Connect to your Arciin server”
2. **Find server** (optional paths):
   - **Manual URL**: user enters `http://192.168.x.x:3000` or API host `http://192.168.x.x:4000`
   - **Discover**: `GET {apiBase}/mobile/discover` — try LAN scan by probing common hosts *or* call discover on entered API base
   - Show `instanceName`, `version`, `initialized`
3. **Connection code** — 6 digits; optional `POST .../mobile/pair/verify` for early validation
4. **Sign in** — email + password + optional device name
5. **Pair** — `POST {apiBase}/mobile/pair` body:

```json
{
  "code": "123456",
  "email": "admin@example.com",
  "password": "your-password",
  "deviceName": "iPhone"
}
```

6. **Persist** (secure storage / localStorage):
   - `sessionToken`
   - `sessionExpiresAt`
   - `apiBaseUrl`, `socketUrl`, `webUrl`, `instanceName`

7. **Main app** — use stored endpoints for all API calls

## Authenticated requests

```http
Authorization: Bearer <sessionToken>
```

Session tokens are opaque hex strings (not `arc_` API keys). Same token works for:

- REST: `{apiBaseUrl}/...` (e.g. `/api/auth/me`, `/api/libraries`, uploads)
- Socket.IO: connect to `socketUrl` with `auth: { token: sessionToken }` **or** header `Authorization: Bearer <sessionToken>` (server accepts both cookie and bearer session)

Use `credentials: "include"` only when same-origin; for cross-origin mobile PWA use **Bearer only**.

## Discover response shape

```json
{
  "data": {
    "service": "arciin",
    "initialized": true,
    "instanceName": "My Homelab",
    "version": "0.1.0",
    "webUrl": "http://192.168.4.22:3000",
    "apiBaseUrl": "http://192.168.4.22:4000/api",
    "socketUrl": "http://192.168.4.22:4000",
    "requestOrigin": "http://192.168.4.22:3000",
    "pairingSupported": true
  }
}
```

If `webUrl` is `localhost` but `requestOrigin` is a LAN IP, prefer rewriting URLs to the LAN host for the phone.

## Pair response shape

```json
{
  "data": {
    "sessionToken": "<hex>",
    "sessionExpiresAt": "2026-...",
    "user": { "id", "name", "email", "role", ... },
    "server": { "webUrl", "apiBaseUrl", "socketUrl", "instanceName", "version", "requestOrigin" }
  }
}
```

## Error codes

| Code | Meaning |
|------|---------|
| `INVALID_PAIRING_CODE` | Expired or wrong code |
| `INVALID_CREDENTIALS` | Bad email/password |
| `INSTANCE_NOT_READY` | Server not set up |

## LAN discovery tips (client-side)

Browsers cannot rely on mDNS in all PWAs. Practical approach:

1. Let user enter server IP or hostname once.
2. Probe `http://{host}:4000/api/mobile/discover` (and optionally port from env).
3. Optionally scan subnet `192.168.0.0/24` last octet 1–254 (slow; show progress; user opt-in).

## MVP screens after login

- Dashboard summary (`/api/...` as web app)
- Libraries / recent uploads
- Upload from camera/gallery (multipart to `/api/uploads`)
- Activity feed
- Settings: disconnect (clear stored token), show server name

## PWA requirements

- `manifest.json` + service worker
- Safe-area insets for notched phones
- Dark UI aligned with Arciin (zinc/black, orange `#FF4F12` accent)

## Do not

- Reimplement server auth, storage, or processing
- Hardcode production secrets
- Assume cookies work cross-origin

## Test against a real server

1. Open Arciin web → **Settings → Mobile connection** → **Generate connection code**
2. From phone on same Wi‑Fi, point mobile app at `http://<server-ip>:4000/api`
3. Enter code + Arciin user credentials
4. Call `GET /api/auth/me` with Bearer token to confirm
