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
ARCIIN_DATA_DIR="${ARCIIN_DATA_DIR:-/srv/arciin-storage/arciin}"

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
    "${root}/logs" \
    "${root}/avatars"
}

recover_chat_migration_failure() {
  # Fresh installs before 20260515110000_chat_tables could fail on feedback ALTER.
  local migrate_log
  migrate_log="$(mktemp)"
  if pnpm exec prisma migrate deploy >"${migrate_log}" 2>&1; then
    cat "${migrate_log}"
    rm -f "${migrate_log}"
    return 0
  fi

  if grep -q '20260515120000_chat_message_feedback' "${migrate_log}" \
    || grep -q 'relation "ChatMessage" does not exist' "${migrate_log}"; then
    warn "Chat migration out of order — marking failed step rolled back and retrying"
    pnpm exec prisma migrate resolve --rolled-back 20260515120000_chat_message_feedback \
      >>"${migrate_log}" 2>&1 || true
    rm -f "${migrate_log}"
    log "Re-applying database migrations (prisma migrate deploy)"
    pnpm exec prisma migrate deploy
    return $?
  fi

  cat "${migrate_log}" >&2
  rm -f "${migrate_log}"
  return 1
}

run_migrations() {
  log "Applying database migrations (prisma migrate deploy)"
  recover_chat_migration_failure
  local count
  count="$(find "${ROOT_DIR}/prisma/migrations" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  log "Migration folders on disk: ${count} (includes bootstrap, chat, password vault, mobile pairing, session vault unlock, etc.)"
}

run_seed() {
  log "Seeding database defaults"
  if pnpm db:seed; then
    return 0
  fi
  warn "Seed failed — if you just pulled new migrations, run: pnpm exec prisma migrate deploy && pnpm db:seed"
  return 1
}

report_claim_state() {
  # Best-effort; never fails init. Helps operators see why UI shows login vs setup.
  if ! command -v psql >/dev/null 2>&1; then
    return 0
  fi
  local user_count=0 instance_count=0
  user_count="$(psql "${DATABASE_URL}" -tAc 'SELECT COUNT(*)::text FROM "User"' 2>/dev/null | tr -d '[:space:]' || echo 0)"
  instance_count="$(psql "${DATABASE_URL}" -tAc 'SELECT COUNT(*)::text FROM "InstanceConfig"' 2>/dev/null | tr -d '[:space:]' || echo 0)"
  user_count="${user_count:-0}"
  instance_count="${instance_count:-0}"
  if [[ "$user_count" =~ ^[1-9][0-9]*$ ]]; then
    log "Claim state: claimed (${user_count} user(s)) — open /login, not /setup"
  elif [[ "$instance_count" =~ ^[1-9][0-9]*$ ]]; then
    log "Claim state: partial (InstanceConfig without users) — /setup should reclaim"
  else
    log "Claim state: unclaimed — open /setup to create the owner account"
  fi
}

wait_for_postgres
run_migrations
if ! run_seed; then
  ensure_storage_dirs
  exit 1
fi
ensure_storage_dirs
report_claim_state

log "Database and storage initialization complete"
