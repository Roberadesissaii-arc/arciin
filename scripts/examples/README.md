# Arciin Python API examples

Runnable scripts for self-hosted automation. Each file is standalone: edit **`arciin_example_client.py`** once, then run any example.

```bash
pip install requests
# Socket.IO examples also need:
pip install "python-socketio[client]" websocket-client
```

## WSL (Arciin in WSL, Python on Windows)

```bash
bash scripts/examples/arciin_wsl_hosts.sh
```

Set `API_BASE` in `arciin_example_client.py` to `http://<WSL-IP>:4000/api`.

## Auth config (`arciin_example_client.py`)

Placeholders only — replace before running:

| Setting | Example placeholder |
|---------|---------------------|
| `API_KEY` | `arc_paste_full_key_here` → your full `arc_…` key |
| `EMAIL` | `admin@example.com` → your login email |
| `PASSWORD` | `change-me` → your password |

Use `AUTH_MODE = "api_key"` for scripts, or `"email"` for session cookie auth (Socket.IO).

## Examples

| Script | What it does |
|--------|----------------|
| `health_check_example.py` | Ping API, database, Redis, worker |
| `list_libraries_example.py` | List Videos, Images, Music, … with ids |
| `list_folders_example.py` | List folders inside a library |
| `create_folder_example.py` | Create a folder under a library |
| `upload_image_example.py` | Upload an image to the Images library |
| `upload_video_example.py` | Upload a video to the Videos library |
| `upload_auto_classify_example.py` | Upload without library — MIME auto-route |
| `list_assets_example.py` | List recent assets (optional library filter) |
| `app_databases_example.py` | List logical App data databases |
| `socket_events_example.py` | Listen to live Socket.IO events |

## API keys

Create a key in **Developer → API keys**. Scopes by script:

- **uploads:create** — upload examples
- **libraries:read** — list libraries / folders / assets
- **libraries:write** — create folder
- **appdata:databases:read** — app databases example
- **events:subscribe** — socket events example

Use the **full** `arc_…` secret from the one-time dialog, not the short table prefix.
