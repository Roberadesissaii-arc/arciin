# Arciin REST API examples (Python)

Runnable scripts for uploads, libraries, folders, and assets. Edit shared config once in **`../lib/arciin_client.py`**, then run any script below.

## Install

```bash
pip install requests
```

## Configure (one file)

Edit `scripts/examples/lib/arciin_client.py`:

| Setting | What to set |
|---------|-------------|
| `API_BASE` | `http://127.0.0.1:4000/api` or `http://<LAN-IP>:4000/api` |
| `API_KEY` | Full `arc_…` secret from **Developer → API keys** |
| `AUTH_MODE` | `"api_key"` (recommended) or `"email"` for session cookies |

**WSL:** Arciin in WSL, Python on Windows → run `bash scripts/examples/lib/wsl_hosts.sh` and use the printed IP.

## Scripts

| Script | What it does | API key scopes |
|--------|----------------|----------------|
| `01_health_check.py` | Ping API, database, Redis, worker | *(none — public)* |
| `02_list_libraries.py` | List Videos, Images, Music, … with ids | `libraries:read` |
| `03_list_folders.py` | List folders inside one library | `libraries:read` |
| `04_create_folder.py` | Create a folder under a library | `libraries:write` |
| `05_list_assets.py` | List recent files (all or one library) | `assets:read` or `libraries:read` |
| `06_upload_to_library.py` | Upload a file to a specific library | `uploads:create`, `libraries:read` |
| `07_upload_auto_classify.py` | Upload — Arciin picks library by file type | `uploads:create` |
| `08_list_app_databases.py` | List logical App data databases | `appdata:databases:read` |

## Run

From the repo root:

```bash
python scripts/examples/api/01_health_check.py
python scripts/examples/api/06_upload_to_library.py /path/to/photo.jpg
```

## Realtime events (Socket.IO)

For live event monitors (upload.completed, asset.created, …), use the separate **`../events/`** folder — see `../events/README.md`.
