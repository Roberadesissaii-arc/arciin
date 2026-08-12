# Remote access: one domain, both apps

Arciin runs two Next.js apps against one API:

| App | Port | Serves |
|---|---|---|
| Desktop web | `ARCIIN_WEB_PORT` (3002) | full UI, public share and upload links, `/api`, `/socket.io` |
| Mobile PWA | `ARCIIN_MOBILE_PORT` (3003) | phone-shaped UI |

**They share one public address.** Open it on a phone and you get the mobile
app; open it on a computer and you get the desktop app. There is nothing
separate to remember and no second link to keep track of.

## Why it works this way

Arciin can only ever run **one** Cloudflare quick tunnel. `cloudflared` is
spawned as a single child process of the API and
`startCloudflareQuickTunnel()` stops the running one before starting another.

So a second tunnel for the mobile app could only ever exist by killing the
desktop one. That is exactly what used to happen: generating a mobile domain
took the desktop domain away, and vice versa. Worse, auto-start preferred the
mobile port whenever the two differed, so the desktop address kept disappearing
on its own after a restart.

The fix is to stop trying to have two. One tunnel points at the desktop origin,
and `apps/web/proxy.ts` decides per request which app answers.

> **Next 16 note:** the `middleware` file convention was renamed to `proxy`.
> The file must be named `proxy.ts` and export `proxy`, or it silently never
> runs and every request falls through to the desktop app.

## Routing rules

Implemented in `packages/shared/src/app-surface.ts`, unit-tested in
`tests/app-surface.test.ts`.

**Always the desktop app, whatever the device:**

- `/api/*` and `/socket.io/*` — the desktop app proxies to Fastify while
  preserving the real client IP (`lib/server/api-proxy.ts`). Routing these
  through the mobile app would add a hop and lose it.
- `/s/*` (shares) and `/request/*` (file requests) — these routes exist only in
  the desktop app. Device-routing them would 404 exactly the people the link was
  sent to, and share links are opened on phones more than anywhere else.

**Everything else follows the device**, with two overrides:

1. `?view=desktop` or `?view=mobile` — an explicit choice, remembered in the
   `arciin_view` cookie.
2. Tablets and unknown user agents get the desktop app. It is the responsive
   one, so an unrecognised client degrades to the richer UI.

**Assets follow their page, not the device.** Both apps serve their own
`/_next/*` bundles under the same paths. A share link opened on a phone is
served by the *desktop* app, so its bundles must come from there too — routing
assets by user agent made every share render blank. The app that serves a
document records itself in `arciin_surface`, and asset requests follow that.

Two cookies, because they answer different questions: `arciin_view` is the
user's explicit choice and survives navigation; `arciin_surface` is only "what
served the last page".

## Configuration

```bash
ARCIIN_WEB_PORT=3002            # desktop app
ARCIIN_MOBILE_PORT=3003         # mobile PWA
ARCIIN_MOBILE_ORIGIN=http://127.0.0.1:3003   # optional; derived from the port
ARCIIN_UNIFIED_DOMAIN=true      # set false to serve only the desktop app
ARCIIN_TUNNEL_AUTOSTART=true    # false disables tunnel auto-start globally
```

If no mobile origin is configured, or the two ports match, everything falls back
to the desktop app. A missing mobile app degrades to "the site works", never to
a 502.

## Generating a public URL

Settings → Domain → **Generate new URL**.

This **forces a fresh tunnel**. Reusing a healthy tunnel is right for auto-start
— a restart should not churn your address for no reason — but wrong for an
explicit click: the button used to return the *existing* address, so nothing
changed and no address-change notification was sent.

Quick tunnels get a new hostname on every restart. `publicUrl` and
`remoteAccessConfig.mobilePublicUrl` are both written with the same value; the
Domain panel shows both and warns if they ever diverge, which only happens with
a stale value left over from the old two-tunnel behaviour.

## When the address changes

1. `persistTunnelPublicUrl()` stores the new URL.
2. An activity event is recorded.
3. `instance.urls.updated` is broadcast over Socket.IO so paired phones
   re-resolve without repairing.
4. Email and Discord notifications fire independently — see
   [`NOTIFICATIONS.md`](./NOTIFICATIONS.md).

That last step exists because the restart usually happens while nobody is
watching. The person who needs the new address is the one who is not at the
server.

## Known gap

A desktop-only deep link opened on a phone (`/dashboard`) returns 404, because
the mobile app has `/home` instead. `?view=desktop` is the workaround. Fixing it
properly needs a route map between the two apps.
