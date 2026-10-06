#!/usr/bin/env bash
# ================================================================
#  Arciin — Docker install from a checkout
#
#  Runs the canonical Docker installer (scripts/docker-install.sh), the same
#  one the public one-liner downloads, with this checkout's Compose file and
#  Caddyfile. Production images are the published ones for this checkout's
#  version, pinned by digest — nothing is built here.
#
#  Usage:  ./scripts/docker-setup.sh [docker-install.sh options]
#          ./install.sh --docker      (same thing)
#
#  To build and run unreleased code in Docker, use scripts/docker-smoke-test.sh.
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
export ARCIIN_VERSION="${ARCIIN_VERSION:-$version}"
export ARCIIN_LOCAL_ASSETS="$ROOT_DIR"

# Before v1.1.4 this script ran the development compose file from the checkout:
# project named after this folder, .env in the checkout. Adopt that stack —
# same project, same volumes, same password — instead of starting a new one.
legacy_project="$(basename "$ROOT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
docker_cmd=(docker)
docker info >/dev/null 2>&1 || docker_cmd=(sudo docker)
if [[ -z "${ARCIIN_COMPOSE_PROJECT:-}" ]] \
  && "${docker_cmd[@]}" volume inspect "${legacy_project}_postgres_data" >/dev/null 2>&1 \
  && grep -q '^POSTGRES_PASSWORD=.' "$ROOT_DIR/.env" 2>/dev/null; then
  export ARCIIN_COMPOSE_PROJECT="$legacy_project"
  target="${ARCIIN_DIR:-/opt/arciin}"
  if [[ ! -f "$target/.env" ]]; then
    echo "  Adopting the existing Docker install (project '${legacy_project}', settings from ./.env)."
    sudo mkdir -p "$target"
    sudo chown "$(id -u):$(id -g)" "$target"
    install -m 600 "$ROOT_DIR/.env" "$target/.env"
  fi
fi

exec bash "$ROOT_DIR/scripts/docker-install.sh" "$@"
