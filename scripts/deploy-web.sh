#!/usr/bin/env bash
#
# Atomic web deploy.
#
# The previous procedure built straight into the live `apps/web/.next`
# (`build:clean` even deleted it first). Next names bundles by content hash, so
# for the whole length of a build production served HTML pointing at chunks that
# had already been removed — and a build that died partway left `.next` without
# a BUILD_ID, manifests or `pages/500.html`, which is how the running server
# ended up answering static requests with 500.
#
# So: build into a staging directory, refuse to ship it unless it is complete,
# swap it in with a rename, and roll back if the restarted server fails its
# smoke test. The live directory is only ever a finished build.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="${ROOT}/apps/web"
STAGE="${WEB}/.next-build"
LIVE="${WEB}/.next"
PREV="${WEB}/.next-prev"

PORT="${PORT:-$(grep -E '^PORT=' "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2 || echo 3000)}"
ORIGIN="http://127.0.0.1:${PORT}"
ROUTES="${ROUTES:-/login,/dashboard,/settings,/chat,/}"

say() { echo "[deploy-web] $*"; }

say "building into $(basename "$STAGE") (live build untouched)"
rm -rf "$STAGE"
( cd "$ROOT" && NEXT_DIST_DIR=.next-build NODE_ENV=production \
    ARCIIN_ENV_NAMESPACE=production pnpm --filter @arciin/web build )

say "verifying build completeness before it goes anywhere near production"
node "${ROOT}/scripts/verify-web-assets.mjs" --dist "$STAGE"

say "swapping build into place"
rm -rf "$PREV"
[ -d "$LIVE" ] && mv "$LIVE" "$PREV"
mv "$STAGE" "$LIVE"

say "restarting web only (api/worker untouched)"
pm2 restart arciin-web --update-env >/dev/null

say "waiting for the server to answer"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 3 "${ORIGIN}/login" 2>/dev/null; then break; fi
  sleep 1
done

say "smoke-testing served assets"
if node "${ROOT}/scripts/verify-web-assets.mjs" --url "$ORIGIN" --routes "$ROUTES"; then
  say "deploy OK (BUILD_ID $(cat "${LIVE}/BUILD_ID"))"
  exit 0
fi

say "SMOKE TEST FAILED — rolling back to the previous build"
if [ -d "$PREV" ]; then
  rm -rf "$LIVE"
  mv "$PREV" "$LIVE"
  pm2 restart arciin-web --update-env >/dev/null
  say "rolled back to BUILD_ID $(cat "${LIVE}/BUILD_ID" 2>/dev/null || echo unknown)"
else
  say "no previous build to roll back to — web is left stopped-bad, investigate now"
fi
exit 1
