#!/usr/bin/env bash
#
# Docker smoke test v2 (v1.1.4): unreleased code through the REAL install path.
#
# Builds the three images from this checkout, then runs the canonical
# installer (scripts/docker-install.sh) on docker-compose.production.yml as an
# isolated project (`arciin-test`, its own port, volumes, config dir and data
# dir) and runs the security scenario against it. It never touches a running
# Arciin, PM2 or the `arciin` Compose project.
#
#   bash scripts/docker-smoke-test.sh          # build + install + verify (left running)
#   bash scripts/docker-smoke-test.sh --down   # remove the test project and its volumes
#
# Released images are verified by digest in CI (.github/workflows/install-docker.yml);
# this local path uses unpinned local images, which only the test flag allows.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="arciin-test"
SMOKE_DIR="${ARCIIN_SMOKE_DIR:-$ROOT/.smoke/arciin}"
DATA_DIR="${ARCIIN_TEST_DATA_DIR:-/srv/arciin-storage/arciin-docker-test}"
HTTP_PORT="${ARCIIN_HTTP_PORT:-8087}"
VERSION="$(node -p 'require("./package.json").version' 2>/dev/null || sed -n 's/.*"version": "\(.*\)".*/\1/p' "$ROOT/package.json" | head -1)"

docker ps >/dev/null 2>&1 || { echo "Cannot reach the Docker daemon (docker group or sudo needed)." >&2; exit 1; }

if [[ "${1:-}" == "--down" ]]; then
  if [[ -f "$SMOKE_DIR/docker-compose.yml" ]]; then
    docker compose -p "$PROJECT" --project-directory "$SMOKE_DIR" -f "$SMOKE_DIR/docker-compose.yml" \
      --env-file "$SMOKE_DIR/.env" down -v --remove-orphans
  else
    docker compose -p "$PROJECT" down -v --remove-orphans 2>/dev/null || true
  fi
  rm -rf "$SMOKE_DIR"
  echo "Removed project ${PROJECT}. (Left ${DATA_DIR}; delete it by hand if you want.)"
  exit 0
fi

echo "Building images ${VERSION} from this checkout…"
for target in api worker web; do
  docker build -q --target "$target" -t "arciin-${target}:smoke" \
    --label "org.opencontainers.image.version=${VERSION}" "$ROOT" >/dev/null \
    || { echo "Build of ${target} failed." >&2; exit 1; }
done

mkdir -p "$SMOKE_DIR"
manifest="$SMOKE_DIR/stable.smoke.json"
cat >"$manifest" <<JSON
{
  "schema": 2,
  "version": "${VERSION}",
  "image_web": "arciin-web:smoke",
  "image_api": "arciin-api:smoke",
  "image_worker": "arciin-worker:smoke",
  "assets_base": "file://${ROOT}/"
}
JSON

common=(
  ARCIIN_ALLOW_UNPINNED_IMAGES=1 ARCIIN_MANIFEST="$manifest" ARCIIN_LOCAL_ASSETS="$ROOT"
  ARCIIN_DIR="$SMOKE_DIR" ARCIIN_COMPOSE_PROJECT="$PROJECT" ARCIIN_HTTP_PORT="$HTTP_PORT"
  ARCIIN_HOST_DATA_DIR="$DATA_DIR" ARCIIN_ASSUME_YES=1 ARCIIN_SKIP_FIREWALL=1 ARCIIN_SKIP_MDNS=1
)
echo "Installing with scripts/docker-install.sh (project ${PROJECT}, port ${HTTP_PORT})…"
env "${common[@]}" bash "$ROOT/scripts/docker-install.sh" || exit 1

echo ""
echo "Security checks:"
env "${common[@]}" ARCIIN_SCENARIO_CONFIRM=disposable ARCIIN_SCENARIO_LOGS="$SMOKE_DIR/logs" \
  bash "$ROOT/tests/install/docker-scenarios.sh" security
rc=$?
echo ""
echo "Left running: http://localhost:${HTTP_PORT}   (tear down: bash scripts/docker-smoke-test.sh --down)"
exit "$rc"
