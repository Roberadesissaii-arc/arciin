#!/usr/bin/env bash
#
# Arciin backup — database + storage, to a directory you choose.
#
# Written after a bug in Trash deleted 116 originals that were still referenced
# by live assets. Nothing could be recovered: the bytes were the only copy.
#
#   bash scripts/backup.sh                 # -> $ARCIIN_BACKUP_DIR or /srv/arce-projects/arciin-backups
#   bash scripts/backup.sh /mnt/usb        # -> explicit destination
#
# Cron (daily 03:15):
#   15 3 * * * cd /srv/arce-projects/arciin && bash scripts/backup.sh >> logs/backup.log 2>&1
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[[ -f .env ]] && set -a && . ./.env && set +a

DEST="${1:-${ARCIIN_BACKUP_DIR:-/srv/arce-projects/arciin-backups}}"
STORAGE="${ARCIIN_DATA_DIR:-/srv/arciin-storage/arciin}"
KEEP="${ARCIIN_BACKUP_KEEP:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${DEST}/${STAMP}"

echo "[backup] destination : ${OUT}"
mkdir -p "${OUT}"

# ── Database ──────────────────────────────────────────────────────────────────
# Custom format so restore can be selective and parallel.
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[backup] dumping postgres…"
  pg_dump --format=custom --no-owner --no-privileges \
    --file="${OUT}/database.dump" "${DATABASE_URL}"
  echo "[backup]   $(du -h "${OUT}/database.dump" | cut -f1) database.dump"
else
  echo "[backup] WARNING: DATABASE_URL unset — skipping database" >&2
fi

# ── Storage ───────────────────────────────────────────────────────────────────
# Hard-links against the previous run, so each snapshot costs only what changed
# while still being a complete, independently restorable tree.
if [[ -d "${STORAGE}" ]]; then
  echo "[backup] syncing storage from ${STORAGE}…"
  PREV="$(find "${DEST}" -maxdepth 1 -mindepth 1 -type d -name '20*' ! -name "${STAMP}" | sort | tail -1)"
  LINK_ARG=()
  [[ -n "${PREV}" && -d "${PREV}/storage" ]] && LINK_ARG=(--link-dest="${PREV}/storage")

  # thumbnails and temp are regenerable; objects are the irreplaceable part.
  rsync -a --delete "${LINK_ARG[@]}" \
    --exclude 'temp/' --exclude 'logs/' \
    "${STORAGE}/" "${OUT}/storage/"
  echo "[backup]   $(du -sh "${OUT}/storage" | cut -f1) storage (apparent)"
else
  echo "[backup] WARNING: storage dir ${STORAGE} not found — skipping" >&2
fi

# ── Config ────────────────────────────────────────────────────────────────────
# .env holds SESSION_SECRET and the vault encryption key. Without it the backed-up
# vault ciphertext is undecryptable, so the backup is only useful alongside it.
if [[ -f .env ]]; then
  cp .env "${OUT}/env.backup"
  chmod 600 "${OUT}/env.backup"
  echo "[backup]   env.backup (chmod 600 — contains secrets)"
fi

printf 'arciin backup\ncreated: %s\nhost: %s\nstorage: %s\n' \
  "$(date -Is)" "$(hostname)" "${STORAGE}" > "${OUT}/MANIFEST.txt"

# ── Retention ─────────────────────────────────────────────────────────────────
mapfile -t OLD < <(find "${DEST}" -maxdepth 1 -mindepth 1 -type d -name '20*' | sort | head -n "-${KEEP}")
for dir in "${OLD[@]:-}"; do
  [[ -n "${dir}" ]] || continue
  echo "[backup] pruning ${dir}"
  rm -rf "${dir}"
done

echo "[backup] done — $(du -sh "${OUT}" | cut -f1) at ${OUT}"
echo "[backup] restore: bash scripts/restore.sh ${OUT}"
