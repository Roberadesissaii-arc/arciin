#!/usr/bin/env bash
# ================================================================
#  Package the customer-facing private distribution bundle (no source).
#  Output: dist/arciin-private-release/
#          dist/arciin-private-release.tar.gz
#
#  Customers receive compose + env template + install script + Caddyfile.
#  They never receive the monorepo. Images come from a private registry later.
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/dist/arciin-private-release"
TARBALL="${ROOT_DIR}/dist/arciin-private-release.tar.gz"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/docker/caddy" "$OUT_DIR/scripts/lib"

cp "${ROOT_DIR}/docker-compose.production.yml" "${OUT_DIR}/docker-compose.yml"
cp "${ROOT_DIR}/.env.production.example" "${OUT_DIR}/.env.example"
cp "${ROOT_DIR}/docker/caddy/Caddyfile" "${OUT_DIR}/docker/caddy/Caddyfile"
cp "${ROOT_DIR}/scripts/install-private.sh" "${OUT_DIR}/install.sh"
cp "${ROOT_DIR}/scripts/lib/open-firewall-ports.sh" "${OUT_DIR}/scripts/lib/open-firewall-ports.sh"
cp "${ROOT_DIR}/scripts/open-firewall.sh" "${OUT_DIR}/scripts/open-firewall.sh"
chmod +x "${OUT_DIR}/install.sh" "${OUT_DIR}/scripts/open-firewall.sh" "${OUT_DIR}/scripts/lib/open-firewall-ports.sh"

cat > "${OUT_DIR}/README.md" <<'EOF'
# Arciin — private install bundle

This package is the **customer distribution prototype**. It does **not** include Arciin source code.

## Requirements

- Linux host with Docker Engine + Compose v2
- Port 80 free (or set `ARCIIN_HTTP_PORT` in `.env`)
- Disk for media: default `/srv/arciin-storage/arciin`

## Install

```bash
chmod +x install.sh
./install.sh
```

What the installer does:

1. Creates `/srv/arciin` (config) and `/srv/arciin-storage/arciin` (files)
2. Copies compose + Caddyfile into `/srv/arciin`
3. Creates `.env` from `.env.example` if missing
4. Generates `SESSION_SECRET`, setup token, DB/Redis passwords
5. Opens firewall ports (UFW/firewalld) so browsers can reach HTTP — including enabling UFW if it was inactive
6. Runs `docker compose pull` (when images are on a registry)
7. Runs `docker compose up -d`
8. Prints the setup URL and License next steps

Re-open ports later: `bash scripts/open-firewall.sh`

### Local prototype (images not published yet)

On a build machine with the monorepo:

```bash
pnpm docker:build
# optional: docker save / load or private registry
ARCIIN_SKIP_PULL=1 ./install.sh
```

## After install

1. Open `http://localhost/setup?token=…` (token in `/srv/arciin/.env`)
2. Free core works without a paid license (files, libraries, uploads)
3. **Settings → License** — activate demo keys (`ARCIIN-DEV-PRO`, `arc_demo_pro_…`)
4. Paid UI unlocks; deactivate to re-lock

## Updates (future)

```bash
cd /srv/arciin
docker compose pull
docker compose up -d
```

No `git clone` of the monorepo.

## What you never need

- Full source repository
- Node/pnpm on the host
- Host Postgres/Redis (they run in Compose)

## Out of scope for this prototype

- Public image registry
- Stripe billing
- Hosted license cloud
EOF

(
  cd "${ROOT_DIR}/dist"
  tar -czf "arciin-private-release.tar.gz" arciin-private-release
)

echo "Packed: ${OUT_DIR}"
echo "Tarball: ${TARBALL}"
