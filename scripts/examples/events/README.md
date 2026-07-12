# Arciin Socket.IO event monitors (Python)

Copy any script below to another computer, edit the **CONFIG** block at the top, install deps, and run it while you use Arciin (upload a file, block an IP, etc.). Compare output with the dashboard **Events** page (`/events`).

## Install (once per machine)

```bash
pip install requests "python-socketio[client]" websocket-client
```

## Before you run

1. Arciin **API** must be reachable from your PC (default port **4000**).
2. **Redis** must be running on the server — without it, no realtime events are broadcast.
3. For API-key scripts: create a key in **Developer → API keys** with scope **`events:subscribe`** (or `admin`). Paste the **full** `arc_…` secret.
4. For session scripts: use the same email/password you use to sign in to Arciin.

## Find your server IP (important)

The Arciin machine’s LAN IP can change (DHCP). **Do not guess** — on the server run:

```bash
hostname -I | awk '{print $1}'
```

Use that IP in the script:

```python
API_ORIGIN = "http://192.168.4.53:4000"   # LAN API (install.sh opens this in UFW)
```

Or:

```bash
export ARCIIN_API_ORIGIN=http://192.168.4.53:4000
python 01_monitor_api_key.py
```

From your other PC, verify reachability **before** running the monitor:

```bash
ping 192.168.4.53
curl http://192.168.4.53:4000/api/health
```

Both must work. `install.sh` opens **web** and **API** ports in UFW automatically. If `:4000` times out, run `bash install.sh` again or manually: `sudo ufw allow 4000/tcp`.

## Which script to use?

| Script | Best for | Connects to | Auth |
|--------|----------|-------------|------|
| `01_monitor_api_key.py` | Remote server, automation, LAN test | API `:4000` | API key |
| `02_monitor_session_direct_api.py` | Same as API clients, cookie auth | API `:4000` | Email + password |
| `03_monitor_session_via_web.py` | Matches dashboard **Events** page | Web `:3000` / `:3002` | Email + password (login via web) |
| `04_monitor_upload_pipeline.py` | Watch uploads only | API `:4000` | API key |
| `05_monitor_all_events_json.py` | Debug / log every payload as JSON | API `:4000` | API key |

Replace hosts in each file — example for your LAN:

```python
API_ORIGIN = "http://192.168.4.53:4000"   # scripts 01, 02, 04, 05
WEB_ORIGIN = "http://192.168.4.53:3002"   # script 03 only (web UI + proxy)
```

Script 03 uses the **web** port because it mirrors the in-browser Events page (session cookie on the Next.js host).

## Quick test

1. Run `01_monitor_api_key.py` on machine A (after `curl …/api/health` succeeds).
2. On machine B (or browser), upload a file or sign in to Arciin.
3. You should see `upload.completed`, `asset.created`, `activity.created`, etc.
4. Open **Events** in the dashboard — the same event names should appear there.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ConnectTimeoutError` on `:4000` but `ping` works | UFW blocked API — on server: `sudo ufw allow 4000/tcp` or re-run `bash install.sh` |
| `ConnectTimeoutError` on both ports | Wrong server IP — run `hostname -I` on Arciin host |
| `Connection error` / `Unauthenticated` | Check API key scope `events:subscribe`, or email/password |
| Connected but no events | Confirm Redis is up; trigger an upload or login |
| Works on API script but not web script | Use script 03 only after login via **web** URL (`/api/auth/login` on port 3002) |
| Wrong host | API socket URL is the **API** origin (`:4000`), not PostgreSQL/Redis |

## Event names (26 types)

`upload.*` · `asset.*` · `thumbnail.created` · `media.*` · `library.*` · `job.*` · `activity.created` · `instance.urls.updated` · `plex.*`

See `packages/types/src/events.ts` for the canonical list.
