#!/usr/bin/env bash
# Danger: wipes the Arciin instance back to a fresh, unclaimed state.
#
#   - Drops & re-creates the PostgreSQL schema (all data gone)
#   - Deletes all stored files under ARCIIN_DATA_DIR
#   - Optionally flushes Redis (sessions / rate-limit keys)
#
# The ARCIIN_SETUP_TOKEN in .env is kept, so the /setup screen auto-fills it and
# you only choose a name + create the owner account again.
#
# Usage:
#   bash scripts/reset-instance.sh            # interactive confirmation
#   bash scripts/reset-instance.sh --yes      # skip confirmation (scripted)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --yes | -y | --force) FORCE=true ;;
  esac
done

ENV_FILE="${ROOT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DATA_DIR="${ARCIIN_DATA_DIR:-/srv/arciin-storage/arciin}"
SETUP_TOKEN="${ARCIIN_SETUP_TOKEN:-dev-token}"
PUBLIC_URL="${ARCIIN_PUBLIC_URL:-http://localhost:3000}"

# Safety: never operate on an obviously wrong storage root.
case "$DATA_DIR" in
  "" | "/" | "/root" | "/home" | "$HOME")
    echo "[reset] Refusing to wipe unsafe ARCIIN_DATA_DIR: '${DATA_DIR}'" >&2
    exit 1
    ;;
esac

echo "This will PERMANENTLY erase the Arciin instance:"
echo "  • PostgreSQL schema (all libraries, files metadata, users, sessions)"
echo "  • All stored files under: ${DATA_DIR}"
echo "  • Redis keys (if reachable)"
echo
echo "The setup token is kept, so /setup will auto-fill it after reset."
echo

if [[ "$FORCE" != true ]]; then
  read -r -p "Type 'ERASE' to confirm a full fresh install: " confirm
  if [[ "$confirm" != "ERASE" ]]; then
    echo "[reset] Cancelled."
    exit 1
  fi
fi

echo "[reset] Dropping and re-creating the database schema…"
pnpm exec prisma migrate reset --force --skip-seed --schema prisma/schema.prisma

echo "[reset] Clearing stored files under ${DATA_DIR}…"
for sub in objects libraries thumbnails temp logs avatars; do
  target="${DATA_DIR}/${sub}"
  if [[ -d "$target" ]]; then
    rm -rf "${target:?}/"* 2>/dev/null || true
  fi
  mkdir -p "$target"
done

if [[ -n "${REDIS_URL:-}" ]] && command -v redis-cli >/dev/null 2>&1; then
  echo "[reset] Flushing Redis…"
  redis-cli -u "$REDIS_URL" FLUSHALL >/dev/null 2>&1 || echo "[reset] (Redis flush skipped — not reachable)"
fi

echo
echo "[reset] Done. Fresh install ready."
echo "[reset] Restart services, then open setup:"
echo "        pm2 restart arciin-web arciin-mobile arciin-api arciin-worker"
echo "        ${PUBLIC_URL}/setup"
echo "[reset] The setup token is already configured and will auto-fill."
echo "        (token: ${SETUP_TOKEN})"
