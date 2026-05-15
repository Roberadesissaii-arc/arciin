#!/usr/bin/env bash
# Apply Prisma migrations, seed defaults, and ensure local storage directories exist.
# Used by install.sh and Docker API entrypoint.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

log() {
  printf '\n[arciin-init] %s\n' "$1"
}

warn() {
  printf '\n[arciin-init] warning: %s\n' "$1" >&2
}

# shellcheck disable=SC1091
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT_DIR}/.env"
  set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://arciin:arciin@localhost:5432/arciin}"
ARCIIN_DATA_DIR="${ARCIIN_DATA_DIR:-./data/arciin}"

wait_for_postgres() {
  local host port user tries=30
  if [[ "${DATABASE_URL}" =~ postgresql://[^@]+@([^:/]+):?([0-9]*)/ ]]; then
    host="${BASH_REMATCH[1]}"
    port="${BASH_REMATCH[2]:-5432}"
  else
    host="localhost"
    port="5432"
  fi

  if [[ "${host}" != "localhost" && "${host}" != "127.0.0.1" && "${host}" != "postgres" && "${host}" != "db" ]]; then
    log "Remote database host (${host}) — skipping local readiness wait"
    return 0
  fi

  if ! command -v pg_isready >/dev/null 2>&1; then
    warn "pg_isready not found; proceeding without database readiness check"
    return 0
  fi

  log "Waiting for PostgreSQL at ${host}:${port}"
  while (( tries > 0 )); do
    if pg_isready -h "${host}" -p "${port}" >/dev/null 2>&1; then
      log "PostgreSQL is ready"
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done

  warn "PostgreSQL did not become ready in time; migrations may still fail"
}

ensure_storage_dirs() {
  local root
  root="$(cd "${ROOT_DIR}" && mkdir -p "${ARCIIN_DATA_DIR}" && cd "${ARCIIN_DATA_DIR}" && pwd)"
  log "Ensuring storage directories under ${root}"
  mkdir -p \
    "${root}/objects" \
    "${root}/libraries" \
    "${root}/thumbnails" \
    "${root}/temp" \
    "${root}/logs"
}

run_migrations() {
  log "Applying database migrations (prisma migrate deploy)"
  pnpm exec prisma migrate deploy
}

run_seed() {
  log "Seeding database defaults"
  pnpm db:seed
}

wait_for_postgres
run_migrations
run_seed
ensure_storage_dirs

log "Database and storage initialization complete"
