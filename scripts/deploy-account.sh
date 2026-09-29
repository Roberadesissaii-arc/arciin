#!/usr/bin/env bash
#
# Atomic account-portal deploy (vendor host only).
#
# The portal was never part of the deploy: api, worker and web were rebuilt on
# every release while apps/account/.next stayed the build from August. When
# Next.js was upgraded underneath it, every dynamic page returned 500
# ("renderToPipeableStream is not implemented") with the process still
# "online". This builds into a staging directory, refuses to ship a build that
# is incomplete or made by a different Next/React, swaps it in with a rename,
# restarts only arciin-account, and rolls back if the pages do not answer.
#
# The restart keeps the process's stored least-privilege environment (no
# --update-env): the portal must never pick up DATABASE_URL or other Arciin
# secrets from whoever runs this.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ROOT}/apps/account"
STAGE="${APP}/.next-build"
LIVE="${APP}/.next"
PREV="${APP}/.next-prev"
ORIGIN="${ACCOUNT_ORIGIN:-http://127.0.0.1:3010}"
PAGES="${ACCOUNT_PAGES:-/account /account/licenses /account/servers /account/downloads}"

say() { echo "[deploy-account] $*"; }

if ! pm2 describe arciin-account >/dev/null 2>&1; then
  say "no arciin-account process on this host — nothing to deploy"
  exit 0
fi

say "building into $(basename "$STAGE") (live build untouched)"
rm -rf "$STAGE"
( cd "$APP" && NEXT_DIST_DIR=.next-build NODE_ENV=production pnpm build )

say "checking the build is complete and matches the installed Next/React"
[ -f "${STAGE}/BUILD_ID" ] || { say "no BUILD_ID in the staged build — not shipping it"; exit 1; }
( cd "$APP" && NEXT_DIST_DIR=.next-build node "${ROOT}/scripts/next-build-stamp.mjs" check )

say "swapping build into place"
rm -rf "$PREV"
[ -d "$LIVE" ] && mv "$LIVE" "$PREV"
mv "$STAGE" "$LIVE"

say "restarting arciin-account only (stored environment kept)"
pm2 restart arciin-account >/dev/null

smoke() {
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null --max-time 3 "${ORIGIN}/account" 2>/dev/null && break
    sleep 1
  done
  for page in $PAGES; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${ORIGIN}${page}")"
    say "  ${page} -> ${code}"
    [ "$code" = "200" ] || return 1
  done
}

if smoke; then
  say "deploy OK (BUILD_ID $(cat "${LIVE}/BUILD_ID"))"
  exit 0
fi

say "SMOKE TEST FAILED — rolling back to the previous build"
if [ -d "$PREV" ]; then
  rm -rf "$LIVE"
  mv "$PREV" "$LIVE"
  pm2 restart arciin-account >/dev/null
  say "rolled back to BUILD_ID $(cat "${LIVE}/BUILD_ID" 2>/dev/null || echo unknown)"
fi
exit 1
