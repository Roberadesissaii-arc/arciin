# Arciin Python examples

Copy-paste scripts for REST API automation and Socket.IO event monitoring. Organized in two folders:

| Folder | Purpose |
|--------|---------|
| **`api/`** | REST API — health, libraries, folders, uploads, assets |
| **`events/`** | Socket.IO — live event monitors (compare with dashboard **Events**) |

## Quick start

```bash
pip install requests
# Events folder also needs:
pip install "python-socketio[client]" websocket-client
```

### 1. Configure once

Edit **`lib/arciin_client.py`**:

| Setting | Example |
|---------|---------|
| `API_BASE` | `http://127.0.0.1:4000/api` or `http://192.168.x.x:4000/api` |
| `API_KEY` | Full `arc_…` secret from **Developer → API keys** |
| `AUTH_MODE` | `"api_key"` (scripts) or `"email"` (session) |

### 2. Test connectivity

```bash
python scripts/examples/api/01_health_check.py
```

### 3. Run any API example

```bash
python scripts/examples/api/02_list_libraries.py
python scripts/examples/api/06_upload_to_library.py /path/to/photo.jpg
```

See **`api/README.md`** for the full script list and required API key scopes.

### 4. Monitor realtime events

```bash
cd scripts/examples/events
# Edit CONFIG in 01_monitor_api_key.py
python 01_monitor_api_key.py
```

See **`events/README.md`** for all five Socket.IO monitors.

## WSL (Arciin in WSL, Python on Windows)

```bash
bash scripts/examples/lib/wsl_hosts.sh
```

Set `API_BASE` in `lib/arciin_client.py` to `http://<WSL-IP>:4000/api`.

## API key scopes

| Task | Scopes |
|------|--------|
| Health check | *(none)* |
| List libraries / folders | `libraries:read` |
| Create folder | `libraries:write` |
| List assets | `assets:read` or `libraries:read` |
| Upload files | `uploads:create` (+ `libraries:read` to pick library) |
| App data databases | `appdata:databases:read` |
| Socket.IO events | `events:subscribe` |

Use the **full** `arc_…` secret from the one-time create dialog — not the short table prefix.

## Layout

```
scripts/examples/
├── README.md           ← you are here
├── lib/
│   ├── arciin_client.py   ← shared config + helpers (API scripts)
│   └── wsl_hosts.sh       ← WSL IP helper
├── api/
│   ├── README.md
│   ├── 01_health_check.py
│   ├── 02_list_libraries.py
│   └── …
└── events/
    ├── README.md
    ├── 01_monitor_api_key.py
    └── …
```
