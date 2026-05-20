# Docker deployment

Arciin runs in Docker on **any Linux host** with Docker Engine and Compose — home servers, NAS boxes, Ubuntu Server, Debian, cloud VMs, and small boards like Raspberry Pi. Containers hold the app stack; your **files stay on a real folder** on disk via a bind mount.

---

## Docker vs `./install.sh` (native)

| | **Docker** (`./scripts/docker-setup.sh`) | **Native** (`./install.sh`) |
|---|------------------------------------------|-----------------------------|
| **Best for** | Most installs — isolated deps, simple updates | Maximum bare-metal performance, existing PM2/Postgres |
| **System packages** | Docker (+ Compose) on the host only | apt: Node, PostgreSQL, Redis, FFmpeg, build tools |
| **Updates** | `docker compose pull && docker compose up -d` | `git pull && ./install.sh` |
| **Your files** | Bind mount: host path → `/data/arciin` in container | `ARCIIN_DATA_DIR` on disk directly |
| **Risk** | Low — rebuild containers without losing media | Host apt conflicts on some systems |

**Recommendation:** Use **Docker** unless you already run and maintain a native Node/Postgres stack on the host. If native `install.sh` fails at “System packages”, switch to Docker.

---

## How storage works (important)

By default, Docker isolates a container’s filesystem. If Arciin wrote only inside the container **without a mount**, your files would disappear when the container is removed.

Arciin avoids that with a **bind mount**:

```text
[ Your SSD/HDD on the host ]     bind mount      [ Inside api + worker ]
/mnt/nvme/arciin-data      <====================>   /data/arciin
```

- Set **`ARCIIN_HOST_DATA_DIR`** in `.env` to the folder on **your machine** (e.g. `/mnt/nvme/arciin-data`).
- Compose mounts it into **api** and **worker** as **`/data/arciin`**.
- Uploads, libraries, thumbnails, and temp files are stored on **physical storage**, not in the container layer.
- **`postgres_data`** and **`redis_data`** stay as Docker named volumes (metadata/queues only).

### Example paths

| Host | Use case |
|------|----------|
| `/srv/arciin-storage/arciin` | **Default** — outside the git clone; safe across app updates |
| `/mnt/ssd/arciin-data` | NVMe or mounted SSD |
| `/media/user/MyDrive/arciin-data` | External USB drive (good for large libraries) |
| `./data/arciin` | Dev-only quick test inside the repo (not recommended for production) |

You do **not** need to run `mkdir` or `rsync` by hand for a normal install.

`./scripts/docker-setup.sh` and `./install.sh`:

1. Ask where to store files (default **`/srv/arciin-storage/arciin`**).
2. Create that folder (with `sudo` if needed).
3. **Migrate automatically** if they find existing data under `data/arciin` in the repo or a previous `ARCIIN_DATA_DIR` / `ARCIIN_HOST_DATA_DIR` in `.env`, and the new location is still empty.
4. Create `objects`, `libraries`, `thumbnails`, and other subfolders.
5. Write the chosen path to `.env` (`ARCIIN_HOST_DATA_DIR` for Docker, `ARCIIN_DATA_DIR` for native).

For Docker, the setup script also sets ownership to uid **1000** when required so the API container can write.

### Moving data out of the git clone

Re-run setup after pulling the latest scripts:

```bash
./install.sh --docker
# or
./scripts/docker-setup.sh
```

Pick **`/srv/arciin-storage/arciin`** (or your preferred path). If the destination is empty and files still live under `./data/arciin`, the installer copies them once and updates `.env`.

Manual `rsync` is only needed when data lives on **another machine** or a path the installer cannot see (for example copying from a different host over SSH).

---

## Database migrations (fresh install & upgrades)

The API container runs `scripts/arciin-init.sh` on every start, which executes **`prisma migrate deploy`**. That applies every migration under `prisma/migrations/` (bootstrap schema, chat, password vault, user avatars, mobile pairing, session vault unlock, and indexes). You do **not** need a manual SQL step for a new machine.

After pulling a newer Arciin image or git tag:

```bash
docker compose pull
docker compose up -d
# API logs should show [arciin-init] Applying database migrations
docker compose logs api | tail -30
```

If migrations fail, check Postgres is healthy (`docker compose ps`) and run once from the repo: `docker compose exec api pnpm exec prisma migrate deploy`.

---

## Quick start

### 1. Install Docker

On Linux (Ubuntu Server, Debian, etc.):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in so the docker group applies
```

See [Docker Engine install docs](https://docs.docker.com/engine/install/) for other platforms.

### 2. Clone Arciin

```bash
git clone https://github.com/Roberadesissaii-arc/arciin.git
cd arciin
```

### 3. Run the Docker setup script

```bash
chmod +x scripts/docker-setup.sh install.sh
./install.sh --docker
```

The script will:

1. Show your detected host name (OS or hardware).
2. Bootstrap `.env` from `.env.docker.example`.
3. Ask where to store files (or use `ARCIIN_HOST_DATA_DIR=/your/path`).
4. Create the storage folder, migrate legacy `data/arciin` if present, and prepare subfolders.
5. Fill in secrets and storage paths in `.env`.
6. Run `docker compose up --build -d`.

The first image build can take several minutes on slower hardware. Later starts are fast.

### 4. Open the setup screen

- **This machine:** [http://localhost/setup](http://localhost/setup) (Caddy on port **80**)
- **Another device on LAN:** `http://<server-ip>/setup?token=<ARCIIN_SETUP_TOKEN>`

Token is in `.env` as `ARCIIN_SETUP_TOKEN`.

---

## Non-interactive setup

```bash
export ARCIIN_HOST_DATA_DIR=/mnt/ssd/arciin-data
./scripts/docker-setup.sh
```

Or:

```bash
./install.sh --docker
ARCIIN_INSTALL_MODE=docker ./install.sh
```

---

## Manual compose (advanced)

```bash
cp .env.docker.example .env
# Edit ARCIIN_HOST_DATA_DIR, ARCIIN_SETUP_TOKEN, SESSION_SECRET, ARCIIN_PUBLIC_URL

export ARCIIN_HOST_DATA_DIR=/mnt/ssd/arciin-data   # must match .env
docker compose up --build -d
```

---

## Host requirements

- **RAM:** 2 GB minimum; 4 GB+ recommended for heavy uploads and media jobs.
- **Port 80** must be free for Caddy (or change `docker-compose.yml` port mapping).
- **LAN access:** set `ARCIIN_PUBLIC_URL=http://<server-ip>` in `.env`, then `docker compose up -d` again.
- **64-bit Linux** recommended for the Node 20 images.

### Native install: “held broken packages”

If `./install.sh` (without Docker) reports:

```text
E: Unable to correct problems, you have held broken packages.
```

That is a **host package conflict**, not an Arciin bug. Options:

1. **Use Docker:** `./install.sh --docker`
2. Fix apt: `sudo apt --fix-broken install && sudo dpkg --configure -a`, then retry native install
3. Skip apt deps if you already have them: `ARCIIN_SKIP_SYSTEM_PACKAGES=1 ./install.sh`

### Raspberry Pi (optional)

Works on **64-bit** Raspberry Pi OS with the same steps as above. Prefer a USB SSD for `ARCIIN_HOST_DATA_DIR` if the SD card is small. First build may take longer on Pi-class hardware.

---

## Cloudflare quick tunnel (public URL)

The **api** container includes **cloudflared** so **Settings → Domain → Generate public URL** works in Docker.

Compose sets `ARCIIN_TUNNEL_TARGET=http://caddy:80` so the tunnel forwards to Caddy (web + API + WebSockets), not `127.0.0.1` inside the container.

After upgrading images, open the app on port **80**, sign in, then generate a new URL from Domain settings.

---

## Everyday commands

```bash
docker compose ps
docker compose logs -f api
docker compose restart api worker
docker compose down
docker compose pull && docker compose up -d    # update (if using published images)

# After git pull — rebuild api (includes cloudflared):
git pull
docker compose up --build -d api
docker compose exec api cloudflared --version
```

Database shell:

```bash
docker compose exec postgres psql -U arciin -d arciin
```

Re-run init (migrations + storage folders):

```bash
docker compose exec api pnpm db:init
```

---

## Architecture (compose)

```text
Browser → Caddy :80 → web (Next.js)
                    → /api, /socket.io → api (Fastify)
api + worker → bind mount ARCIIN_HOST_DATA_DIR → /data/arciin
api + worker → postgres, redis
```

See also [`DEPLOYMENT.md`](./DEPLOYMENT.md) and [`../docker/caddy/Caddyfile`](../docker/caddy/Caddyfile).

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| Upload permission denied | `sudo chown -R 1000:1000 "$ARCIIN_HOST_DATA_DIR"` |
| Port 80 in use | Stop nginx/apache or edit `docker-compose.yml` `caddy.ports` |
| Build fails / **no space left on device** during `COPY . .` | Your media is inside the git folder (e.g. `~/arciin/objects`). Set `ARCIIN_HOST_DATA_DIR=/srv/arciin-storage/arciin`, move data out, then `docker builder prune -f` and rebuild. Never store files in the same directory as the Arciin source clone. |
| Build fails (other) | Check disk space (`docker system df`) and 64-bit OS |
| Phone cannot connect | Set `ARCIIN_PUBLIC_URL` to `http://<lan-ip>`, open firewall for port 80 |
| Data “missing” after rebuild | Check `ARCIIN_HOST_DATA_DIR` in `.env` — files live only on that host path |
| Cannot create storage path | Pick a writable folder or: `sudo mkdir -p <path> && sudo chown -R $USER:$USER <path>` |
| Settings shows `/app/data/arciin`, **Writable: No** | Setup saved the dev path `./data/arciin` instead of the mount. Pull latest, then `docker compose up --build -d api` (auto-fixes to `/data/arciin`), or set **Settings → Storage** root to `/data/arciin` and ensure `sudo chown -R 1000:1000 "$ARCIIN_HOST_DATA_DIR"` |
