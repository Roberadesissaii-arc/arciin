#!/usr/bin/env bash
#
# Arciin restore — from a snapshot made by scripts/backup.sh.
#
#   bash scripts/restore.sh /srv/arce-projects/arciin-backups/20260810-031500
#
# A backup you have never restored is not a backup. Run this against a scratch
# database at least once so you know it works before you need it.
#
set -euo pipefail

SRC="${1:-}"
if [[ -z "${SRC}" || ! -d "${SRC}" ]]; then
  echo "usage: bash scripts/restore.sh <backup-dir>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -f .env ]] && set -a && . ./.env && set +a

STORAGE="${ARCIIN_DATA_DIR:-/srv/arciin-storage/arciin}"

cat <<EOF
About to restore from ${SRC}

  database -> ${DATABASE_URL%%\?*}
  storage  -> ${STORAGE}

This OVERWRITES both. Stop the services first:
  pm2 stop arciin-api arciin-web arciin-worker
EOF
read -r -p "Type 'restore' to continue: " confirm
[[ "${confirm}" == "restore" ]] || { echo "aborted"; exit 1; }

if [[ -f "${SRC}/database.dump" ]]; then
  echo "[restore] restoring database…"
  pg_restore --clean --if-exists --no-owner --no-privileges \
    --dbname "${DATABASE_URL}" "${SRC}/database.dump"
fi

if [[ -d "${SRC}/storage" ]]; then
  echo "[restore] restoring storage…"
  mkdir -p "${STORAGE}"
  rsync -a --delete "${SRC}/storage/" "${STORAGE}/"
fi

echo "[restore] done. Start services:  pm2 start arciin-api arciin-web arciin-worker"
