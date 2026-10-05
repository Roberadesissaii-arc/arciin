# Repairing an Arciin install

Every installer failure ends with the same four parts: **what happened**,
**why**, **what happened to your data**, and **how to recover**. This page
collects the recoveries. Nothing here deletes your files.

Start with the doctor, which is read-only and prints no secrets:

```bash
bash /opt/arciin/arciin-doctor.sh      # Docker
bash scripts/arciin-doctor.sh          # native
```

## The general fix: run the installer again

Re-running the installer is always safe. On a machine that already has
Arciin it repairs in place: it backs up the database (`pg_dump -Fc` into
`<storage>/backups/repair-<timestamp>/`), keeps the instance ID (so your
licence stays bound), keeps settings and secrets, and restarts what is
broken.

```bash
curl -fsSL https://get.arciin.com/install.sh | bash     # Docker
./install.sh --repair                                    # native
```

## Database password mismatch

**Symptom:** the API restarts in a loop; logs mention `P1000` or
`password authentication failed`; the installer says *"the configured password
does not open the existing Arciin database"*.

**Cause:** `.env` was regenerated, edited or replaced while the database kept
its original password. Earlier installers could do this on a re-run.

**Docker:** re-run the installer. It looks for the original settings — in the
existing containers' configuration and in the `.env` backups — and tests each
over the network. Then:

1. **Restore those settings** (default when found) — everything returns, including the encryption key for saved secrets.
2. **Re-key the database user** to the password in `.env` (default when nothing was found) — all data kept.
3. Start fresh — erases the database, typed confirmation only.
4. Cancel.

Non-interactive: `ARCIIN_CREDENTIAL_RECOVERY=1|2|3|4`.

**Native:** re-run `./install.sh --repair`. It re-aligns the `arciin` role's
password to `.env` as the PostgreSQL superuser and proves a real login before
continuing.

## `.env` lost (Docker)

If `/opt/arciin/.env` was deleted but the database volume still exists, the
installer refuses to create new credentials. It restores them from, in order:
the existing containers, `/opt/arciin/backups/env/*.env`, and
`<storage>/backups/install/latest.env` (the copy on your data disk, which
survives losing `/opt/arciin`). If none exists, re-keying keeps all data;
everyone signs in again and saved integration secrets must be re-entered.

## Storage disk not mounted

**Symptom:** *"The storage disk for /mnt/… is not mounted."*

The path is meant to be on a separate disk, but it currently resolves to the
system disk. Writing there would fill it, so the installer stops. Mount the
disk (`sudo mount -a`, check `/etc/fstab`) and re-run. To really keep files on
the system disk, pass `--allow-root-storage`.

## Storage not writable

The installer runs a create/read/rename/delete test as the user the
containers run as (`ARCIIN_PUID`). Fix ownership and re-run:

```bash
sudo chown -R <uid>:<gid> /srv/arciin-storage/arciin
```

For NFS/SMB mounts, map writes to that uid.

## Port already in use

The installer names the process or container holding the port. Either stop
it, or install on another port: `--port 8080`.

## Arciin does not start after a reboot

- **Docker:** `systemctl is-enabled docker` must say `enabled` (the installer enables it); every container must show `restart: unless-stopped` (`bash /opt/arciin/arciin-doctor.sh` checks both).
- **Native:** `systemctl is-enabled pm2-$USER` must say `enabled` and `~/.pm2/dump.pm2` must list the three Arciin processes. `./install.sh --repair` restores both.

## Worker unhealthy

The worker is healthy only while it reaches both Redis and PostgreSQL. An
unhealthy worker with a healthy API usually means the database is
unreachable from the worker — check `docker compose logs worker`.

## Licence: "already in use on another server"

A reinstall with `--fresh` creates a new instance, which needs its own seat.
Settings → License lists the servers holding the seats. Release the old one at
**https://arciin.com/account**, then activate again. A repair never does this:
it keeps the instance ID.

## Licensing service unreachable

`scripts/license-preflight.mjs` (run by both installers and the doctor; in
Docker it runs inside the API container) checks DNS, HTTPS, the clock, and the
verification keys in the build. Fix what it names — usually DNS or egress to
port 443, or the clock (`timedatectl set-ntp true`). Arciin itself works
without licensing.

## Restoring a pre-repair backup

```bash
# Docker
docker compose -p arciin -f /opt/arciin/docker-compose.yml exec -T postgres \
  pg_restore -U arciin -d arciin --clean --if-exists < <storage>/backups/repair-<ts>/arciin.dump
# Native
sudo -u postgres pg_restore -d arciin --clean --if-exists <storage>/backups/repair-<ts>/arciin.dump
```

Each backup folder also holds the `.env` that matched the database at the time
(mode 600).

## Starting over

Only when you mean it. `--fresh` lists exactly what it removes, keeps your
files, backs the database up first, and needs `ERASE ARCIIN` typed. See
[INSTALL.md](INSTALL.md#maintenance-modes).
