#!/usr/bin/env bash
# Production Next.js — requires `pnpm build:web` (or `pnpm build`) first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BIND_HOST="${HOSTNAME:-${ARCIIN_BIND_HOST:-0.0.0.0}}"
PORT="${PORT:-3000}"
BUILD_ID_FILE="${ROOT}/.next/BUILD_ID"

if [[ ! -f "$BUILD_ID_FILE" ]]; then
  echo "[arciin-web] ERROR: No production build in .next (missing BUILD_ID)." >&2
  echo "[arciin-web] After git pull or code changes, run:" >&2
  echo "  cd ${ROOT}" >&2
  echo "  pnpm install" >&2
  echo "  pnpm build          # web + api + worker" >&2
  echo "  pm2 restart arciin-web arciin-api arciin-worker" >&2
  echo "[arciin-web] Or: pnpm deploy   # clean web build + restart all PM2 apps" >&2
  exit 1
fi

exec node "${ROOT}/node_modules/next/dist/bin/next" start -H "${BIND_HOST}" -p "${PORT}"
