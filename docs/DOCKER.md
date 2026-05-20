# Docker & Raspberry Pi

Arciin runs well in Docker on a desktop, NAS, or **Raspberry Pi 4** (64-bit Raspberry Pi OS). Docker keeps PostgreSQL, Redis, Node, and the app inside containers while your **photos and videos live on a real folder** you choose on an SSD, HDD, or USB drive.

---

## Docker vs `./install.sh` (native)

| | **Docker** (`./scripts/docker-setup.sh`) | **Native** (`./install.sh`) |
|---|------------------------------------------|-----------------------------|
| **Best for** | Raspberry Pi, clean servers, “just run it” | Maximum bare-metal performance, existing PM2/Postgres |
| **System packages** | Only Docker (+ Compose) on the host | apt: Node 24, PostgreSQL, Redis, FFmpeg, build tools |
| **Updates** | `docker compose pull && docker compose up -d` | `git pull && ./install.sh` |
| **Your files** | Bind mount: host path → `/data/arciin` in container | `ARCIIN_DATA_DIR` on disk directly |
| **Risk** | Low — rebuild containers without losing media | apt conflicts (“held broken packages”) on some Pis |

**Recommendation:** On Raspberry Pi, or if `install.sh` fails at “System packages”, use **Docker**.

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
| `./data/arciin` | Quick test in the git clone |
| `/mnt/ssd/arciin-data` | NVMe/USB SSD on a Pi or server |
| `/media/pi/MyPassport/arciin` | External USB drive (recommended on Pi for large libraries) |
| `/srv/arciin` | Only if `/srv` is writable by your user, or create with `sudo` first |

Create the folder and ensure the container user can write (uid **1000**):

```bash
sudo mkdir -p /mnt/ssd/arciin-data
sudo chown -R 1000:1000 /mnt/ssd/arciin-data
```

---

## Quick start

### 1. Install Docker

**Raspberry Pi OS (64-bit):**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in so the docker group applies
```

**Ubuntu / Debian server:** same script, or your distro’s `docker.io` + `docker-compose-plugin` packages.

### 2. Clone Arciin

```bash
git clone https://github.com/Roberadesissaii-arc/arciin.git
cd arciin
```

### 3. Run the Docker setup script

```bash
chmod +x scripts/docker-setup.sh
./scripts/docker-setup.sh
```

The script will:

1. Ask where to store files (or use `ARCIIN_HOST_DATA_DIR=/your/path`).
2. Create `.env` with secrets and storage path.
3. Run `docker compose up --build -d`.

First build on a Pi can take **20–40 minutes**. Later starts are fast.

### 4. Open the setup screen

- **This machine:** [http://localhost/setup](http://localhost/setup) (Caddy on port **80**)
- **Phone on LAN:** `http://<pi-ip>/setup?token=<ARCIIN_SETUP_TOKEN>`

Token is in `.env` as `ARCIIN_SETUP_TOKEN`.

---

## Non-interactive setup

```bash
export ARCIIN_HOST_DATA_DIR=/mnt/ssd/arciin-data
./scripts/docker-setup.sh
```

Or from `install.sh`:

```bash
./install.sh --docker
# or
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

## Raspberry Pi notes

- Use **Raspberry Pi OS 64-bit** (aarch64). 32-bit armhf is not supported for the Node 20 stack.
- **RAM:** 2 GB minimum; **4 GB+** recommended for transcoding and many uploads.
- Put **`ARCIIN_HOST_DATA_DIR`** on a **USB SSD** if the SD card is small; keep Postgres on the faster disk when possible.
- **Port 80** must be free (Caddy). Stop other web servers or change the compose port mapping.
- **LAN access:** set `ARCIIN_PUBLIC_URL=http://192.168.x.x` in `.env`, then `docker compose up -d` again.

### “Held broken packages” on `./install.sh`

If apt reports:

```text
E: Unable to correct problems, you have held broken packages.
```

That is a **host package conflict**, not an Arciin bug. Options:

1. **Use Docker** (recommended on Pi): `./scripts/docker-setup.sh`
2. Fix apt: `sudo apt --fix-broken install && sudo dpkg --configure -a`, then retry
3. Skip heavy apt step for a partial native install: `ARCIIN_SKIP_SYSTEM_PACKAGES=1 ./install.sh` (you must install Node, Postgres, Redis, FFmpeg yourself)

---

## Everyday commands

```bash
docker compose ps
docker compose logs -f api
docker compose restart api worker
docker compose down
docker compose pull && docker compose up -d    # update
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
| Build fails on Pi | Ensure 64-bit OS, enough disk space (`docker system df`) |
| Phone cannot connect | Set `ARCIIN_PUBLIC_URL` to `http://<lan-ip>`, open firewall for port 80 |
| Data “missing” after rebuild | Check `ARCIIN_HOST_DATA_DIR` in `.env` — files are only there if the bind mount path is correct |
