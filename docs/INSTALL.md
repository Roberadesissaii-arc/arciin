# Installing Arciin

Arciin runs on your own Linux server. There are two supported ways to install
it, and both are designed to be re-run safely: running the installer again on
a machine that already has Arciin **repairs or upgrades it in place**. It
never starts over on its own.

| | Docker (recommended) | Native |
|---|---|---|
| Command | `curl -fsSL https://get.arciin.com/install.sh \| bash` | `./install.sh` from a checkout |
| What runs | Caddy, web, api, worker, PostgreSQL, Redis in containers | PM2 processes + host PostgreSQL/Redis |
| Build on the server | No — published images, pinned by digest | Yes — needs ~3.5 GB RAM+swap |
| Config | `/opt/arciin/.env` | `.env` in the checkout |
| Your files | `/srv/arciin-storage/arciin` (default) | `/srv/arciin-storage/arciin` (default) |
| Starts after reboot | Docker enabled at boot + `restart: unless-stopped` | `pm2-<user>` systemd unit + saved process list |

## Requirements

- Linux on x86_64. Ubuntu 24.04 and 26.04 are tested on every release in disposable VMs, with real reboots; other current Debian and Ubuntu releases are expected to work. WSL2 works for Docker.
- Free disk: about 8 GB for Docker images, plus space for your files.
- Memory: 2 GB for Docker; 3.5 GB RAM+swap for a native build.
- `sudo` for a few steps (installing Docker or packages, creating the storage folder).
- Outbound HTTPS to `github.com`, `ghcr.io` and `license.arciin.com` (licensing is optional; Arciin works without it).

## Docker — the one-liner

```bash
curl -fsSL https://get.arciin.com/install.sh | bash
```

What happens:

1. The one-liner reads the latest release's `stable.json` from GitHub, downloads the Docker installer it names, and checks the SHA-256 of every file it downloads. A mismatch stops everything.
2. Preflight: architecture, disk, memory, the HTTP port (and who holds it, if busy), Docker and Compose, Docker enabled at boot.
3. The installer looks at what is already there (containers, database volume, `.env`) and decides:
   - nothing there → new install, new secrets;
   - an Arciin database is there → **repair/upgrade**; the database is backed up with `pg_dump` first;
   - the database is there but `.env` is lost or its password is wrong → **credential recovery** (see [REPAIR.md](REPAIR.md)); it never creates new credentials for an existing database.
4. Storage is checked: a disk that should be mounted but isn't stops the install, and a real write test runs as the containers' user.
5. Images are pulled **by digest** and their version labels are verified; every service must report healthy and every container must have `restart: unless-stopped`.

Options (pass after `bash -s --`):

```bash
curl -fsSL https://get.arciin.com/install.sh | bash -s -- --port 8080 --data-dir /mnt/media/arciin
curl -fsSL https://get.arciin.com/install.sh | ARCIIN_VERSION=1.1.4 bash
```

| Option | Environment | Meaning |
|---|---|---|
| `--dir DIR` | `ARCIIN_DIR` | Config folder (default `/opt/arciin`) |
| `--data-dir DIR` | `ARCIIN_HOST_DATA_DIR` | Where your files live (first install only — an existing `.env` wins) |
| `--port N` | `ARCIIN_HTTP_PORT` | Host HTTP port (default 80) |
| `--version X.Y.Z` | `ARCIIN_VERSION` | Install a specific release |
| `--allow-root-storage` | `ARCIIN_ALLOW_ROOT_STORAGE=1` | Accept a `/mnt` or `/media` path that is not a mounted disk |
| `--yes` | `ARCIIN_ASSUME_YES=1` | Never prompt (destructive actions still need the typed phrase) |

### Docker from a checkout

```bash
./install.sh --docker        # or: ./scripts/docker-setup.sh
```

This runs the **same** installer with the checkout's Compose file and the
published images for the checkout's version. A Docker install made from a
checkout before v1.1.4 is adopted in place (same Compose project, volumes and
password).

`docker-compose.yml` in the repository is for development only.

## Native

```bash
git clone https://github.com/Roberadesissaii-arc/arciin.git && cd arciin
./install.sh --native
```

The native installer installs Node, pnpm, PostgreSQL, Redis and PM2 if
missing, builds Arciin, and registers PM2 with systemd. It verifies — rather
than assumes — that:

- the database login with the credentials in `.env` works (a drifted role password is re-aligned, never the database replaced);
- `pm2-<user>` is enabled and the saved process list holds `arciin-api`, `arciin-worker` and `arciin-web`, so Arciin comes back after a reboot.

`apt` never prompts, and a full system upgrade only runs with `ARCIIN_UPGRADE_SYSTEM=1`.

## After installing

Open the URL the installer prints, then `/setup`, and claim the instance with
the setup token it shows. The first account becomes the owner and setup locks.

Check health at any time:

```bash
bash /opt/arciin/arciin-doctor.sh      # Docker
bash scripts/arciin-doctor.sh          # native, from the checkout
```

The doctor is read-only and never prints secrets.

## Maintenance modes

| Goal | Docker | Native |
|---|---|---|
| Repair / upgrade (keeps everything) | re-run the one-liner, or `bash /opt/arciin/docker-install.sh --repair` | `./install.sh --repair` |
| Start over (erases the database, keeps files) | `… --fresh` — type `ERASE ARCIIN` | `./install.sh --fresh` — type `ERASE ARCIIN` |
| Uninstall (keeps database, files, `.env`) | `… --uninstall` | `./install.sh --uninstall` |
| … and erase the database | `… --uninstall --delete-data` — type `ERASE ARCIIN` | same |
| … and delete uploaded files | `… --uninstall --delete-storage` — type `DELETE FILES` | same |

Non-interactive erases need `ARCIIN_CONFIRM_ERASE="ERASE ARCIIN"`. Enter, `y`
and `yes` never confirm an erase.

## Licences and servers

A licence covers a number of servers (Pro: 1). A fresh install creates a new
instance, which needs a free seat. If activation says the licence is in use,
Settings → License lists the servers holding the seats; release one at
**https://arciin.com/account** and activate again. Releasing a seat never
touches that server's files.

## Install journal

Each installer keeps a non-secret journal of what it did — mode, version,
completed steps, the last backup — at `/opt/arciin/install-state.json` (Docker)
or `~/.local/state/arciin/install-state.json` (native). Repairs use it to
resume; it never contains passwords or tokens.

See also: [REPAIR.md](REPAIR.md), [DOCKER.md](DOCKER.md), [DEPLOYMENT.md](DEPLOYMENT.md), [INSTALL-PARITY.md](INSTALL-PARITY.md).
