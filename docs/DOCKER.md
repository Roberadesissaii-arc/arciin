# Docker deployment

Arciin runs in Docker on **any Linux host** with Docker Engine and Compose — home servers, NAS boxes, Ubuntu Server, Debian, cloud VMs, and small boards like Raspberry Pi. Containers hold the app stack; your **files stay on a real folder** on disk via a bind mount.

---

## One Docker install (v1.1.4)

Every Docker install runs the same installer, `scripts/docker-install.sh`, on
the one production Compose definition, `docker-compose.production.yml`:

| Entry point | |
|---|---|
| `curl -fsSL https://get.arciin.com/install.sh \| bash` | Downloads the installer named by the latest release's `stable.json`, checksum-verified |
| `./install.sh --docker` / `./scripts/docker-setup.sh` | Same installer, with this checkout's Compose file and Caddyfile |

Images are the published ones (`ghcr.io/roberadesissaii-arc/arciin-{web,api,worker}`),
**pinned by tag and digest** from the release manifest; nothing is built on
your server. Configuration lives in `/opt/arciin` (`.env`, `docker-compose.yml`,
`Caddyfile`, `docker-install.sh`, `arciin-doctor.sh`, `install-state.json`).

`docker-compose.yml` in the repository is **development only**: it builds from
source and has no restart policies. `install-private.sh` is retired and now
runs the same installer.

| | **Docker** | **Native** (`./install.sh`) |
|---|---|---|
| **Best for** | Most installs — isolated deps, no build on the server | Bare metal, existing PM2/Postgres |
| **System packages** | Docker (+ Compose) only | Node, PostgreSQL, Redis, FFmpeg, build tools |
| **Updates** | re-run the one-liner | `git pull && ./install.sh` |
| **Your files** | Bind mount: host path → `/data/arciin` | `ARCIIN_DATA_DIR` on disk |
| **After a reboot** | Docker enabled at boot + `restart: unless-stopped` | `pm2-<user>` unit + saved process list |

See [INSTALL.md](INSTALL.md) for every option and [REPAIR.md](REPAIR.md) for recovery.

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

You do **not** need to run `mkdir` by hand. The Docker installer:

1. Uses `ARCIIN_HOST_DATA_DIR` from an existing `/opt/arciin/.env` — a re-run never moves your files — or `--data-dir` / the default **`/srv/arciin-storage/arciin`** on a first install.
2. Refuses a path under `/mnt` or `/media` whose disk is not mounted (`--allow-root-storage` to override).
3. Creates `objects`, `libraries`, `thumbnails`, `temp`, `logs` and `backups`.
4. Gives the folder to the containers' user (`ARCIIN_PUID`, your uid by default; never root) — recursively only when it is new or empty — and proves it with a write test as that user.

The native installer does the same for `ARCIIN_DATA_DIR`, and still moves
legacy data from `./data/arciin` in a checkout into the new location when that
location is empty.

### Moving data to another disk

Stop Arciin, copy the folder, point `.env` at it, and re-run the installer:

```bash
cd /opt/arciin && docker compose down
sudo rsync -aHAX /srv/arciin-storage/arciin/ /mnt/big/arciin/
sed -i 's#^ARCIIN_HOST_DATA_DIR=.*#ARCIIN_HOST_DATA_DIR=/mnt/big/arciin#' .env
bash docker-install.sh --repair
```

---

## Host requirements

- **RAM:** 2 GB minimum; 4 GB+ recommended for heavy uploads and media jobs.
- **Port 80** must be free for Caddy, or install with `--port 8080`.
- **LAN access:** the installer sets `ARCIIN_PUBLIC_URL` to `http://<lan-ip>[:port]`; change it in `.env` for a domain or tunnel, then `bash docker-install.sh --repair`.
- **x86_64 Linux** — the published images are amd64.
- **Firewall:** Docker publishes Caddy's port through its own iptables rules, so the Docker installer leaves the host firewall alone (enabling an inactive ufw can lock out SSH). If a cloud or upstream firewall blocks the port, open it there. The native installer opens its web and API ports with `scripts/open-firewall.sh` (skip with `ARCIIN_SKIP_FIREWALL=1`).

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
cd /opt/arciin
docker compose ps
docker compose logs -f api
docker compose restart api worker
bash arciin-doctor.sh                       # read-only health report
bash docker-install.sh --repair             # repair / upgrade in place
curl -fsSL https://get.arciin.com/install.sh | bash   # upgrade to the latest release
```

Database shell:

```bash
docker compose exec postgres psql -U arciin -d arciin
```

`docker compose down` stops Arciin but keeps the database volume; never add
`-v` unless you mean to erase it (`docker-install.sh --uninstall --delete-data`
asks for the typed phrase and backs up first).

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
| Port 80 in use | The installer names the holder. Stop it, or re-run with `--port 8080` |
| Build fails / **no space left on device** during `COPY . .` | Media is still under the clone (often `~/arciin/data/arciin/objects`, shown as multi‑GB “transferring context”). **On the NAS:** `docker builder prune -af` and `docker system prune -f`, then `git pull` and `./install.sh --docker` (setup temporarily moves `data/` aside during build). **Long term:** use `ARCIIN_HOST_DATA_DIR=/srv/arciin-storage/arciin`, copy files there, remove `~/arciin/data` from the repo. |
| Build fails (other) | Check disk space (`docker system df`) and 64-bit OS |
| Phone cannot connect | Set `ARCIIN_PUBLIC_URL` to `http://<lan-ip>`, open firewall for port 80 |
| Data “missing” after rebuild | Check `ARCIIN_HOST_DATA_DIR` in `.env` — files live only on that host path |
| Cannot create storage path | Pick a writable folder or: `sudo mkdir -p <path> && sudo chown -R $USER:$USER <path>` |
| Settings shows `/app/data/arciin`, **Writable: No** | Setup saved the dev path `./data/arciin` instead of the mount. Pull latest, then `docker compose up --build -d api` (auto-fixes to `/data/arciin`), or set **Settings → Storage** root to `/data/arciin` and ensure `sudo chown -R 1000:1000 "$ARCIIN_HOST_DATA_DIR"` |
| **`502 Bad Gateway`** on `/api/*` or `/socket.io` (pages load but data/chat/uploads fail) | Caddy is up but the **api** container is down or still starting. On the server: `docker compose ps` (api should be `running` / `healthy`), then `docker compose logs api --tail 80`. Usually fix with `docker compose up --build -d api worker`. If logs show migration errors: `docker compose exec api pnpm db:init`. If **Exit 137**: Pi ran out of memory during build — `docker builder prune -af`, rebuild one service at a time. Run `bash /opt/arciin/arciin-doctor.sh` for a report. If logs show `P1000`, see [REPAIR.md](REPAIR.md#database-password-mismatch). |
