#!/usr/bin/env bash
# ================================================================
#  Build production Docker images locally (private distribution prototype)
#  Usage (from monorepo root):
#    ./scripts/docker-build-images.sh
#    ./scripts/docker-build-images.sh web|api|worker
#    ARCIIN_IMAGE_TAG=0.1.0 ./scripts/docker-build-images.sh
#
#  Tags default to arciin/arciin-{web,api,worker}:latest
#  Images are for private/local use — do not push publicly yet.
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# shellcheck source=scripts/lib/docker-build-context.sh
source "${ROOT_DIR}/scripts/lib/docker-build-context.sh"

TAG="${ARCIIN_IMAGE_TAG:-latest}"
IMAGE_WEB="${ARCIIN_IMAGE_WEB:-arciin/arciin-web:${TAG}}"
IMAGE_API="${ARCIIN_IMAGE_API:-arciin/arciin-api:${TAG}}"
IMAGE_WORKER="${ARCIIN_IMAGE_WORKER:-arciin/arciin-worker:${TAG}}"

PUBLIC_URL="${ARCIIN_PUBLIC_URL:-http://localhost}"
API_BASE="${NEXT_PUBLIC_API_BASE_URL:-/api}"

TARGET="${1:-all}"

BOLD="\033[1m"
GREEN="\033[32m"
DIM="\033[2m"
RESET="\033[0m"

ok() { echo -e "  ${GREEN}✔${RESET}  $1"; }
info() { echo -e "  ${DIM}$1${RESET}"; }

if ! command -v docker &>/dev/null; then
  echo "Docker is required." >&2
  exit 1
fi

_arciin_docker_build_cleanup() {
  arciin_docker_restore_repo_media "$ROOT_DIR"
}
trap _arciin_docker_build_cleanup EXIT
arciin_docker_stash_repo_media "$ROOT_DIR" || true

build_web() {
  echo -e "${BOLD}Building ${IMAGE_WEB}${RESET}"
  docker build \
    -f Dockerfile --target web \
    -t "${IMAGE_WEB}" \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=${API_BASE}" \
    --build-arg "NEXT_PUBLIC_SOCKET_URL=" \
    --build-arg "ARCIIN_PUBLIC_URL=${PUBLIC_URL}" \
    .
  ok "web → ${IMAGE_WEB}"
}

build_api() {
  echo -e "${BOLD}Building ${IMAGE_API}${RESET}"
  docker build -f Dockerfile --target api -t "${IMAGE_API}" .
  ok "api → ${IMAGE_API}"
}

build_worker() {
  echo -e "${BOLD}Building ${IMAGE_WORKER}${RESET}"
  docker build -f Dockerfile --target worker -t "${IMAGE_WORKER}" .
  ok "worker → ${IMAGE_WORKER}"
}

case "$TARGET" in
  all)
    build_web
    build_api
    build_worker
    ;;
  web) build_web ;;
  api) build_api ;;
  worker) build_worker ;;
  *)
    echo "Usage: $0 [all|web|api|worker]" >&2
    exit 1
    ;;
esac

echo ""
ok "Images ready for private distribution prototype"
info "Run stack:  pnpm docker:up"
info "Or:         docker compose -f docker-compose.production.yml --env-file .env up -d"
echo ""
