#!/usr/bin/env bash
# Pre-migration PostgreSQL backups for safe appliance upgrades (ARC-014).

set -euo pipefail

MIGRATION_BACKUP_RETAIN="${ARCIIN_MIGRATION_BACKUP_RETAIN:-5}"

migration_backup_dir() {
  local root="${ARCIIN_DATA_DIR:-/srv/arciin-storage/arciin}"
  echo "${root}/backups/migrations"
}

has_pending_migrations() {
  local status_log
  status_log="$(mktemp)"
  if pnpm exec prisma migrate status >"${status_log}" 2>&1; then
    if grep -q "Database schema is up to date" "${status_log}"; then
      rm -f "${status_log}"
      return 1
    fi
  fi
  if grep -qiE "not yet been applied|Following migrations" "${status_log}"; then
    rm -f "${status_log}"
    return 0
  fi
  rm -f "${status_log}"
  return 1
}

create_migration_backup() {
  local dir ts file
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "[migration-backup] pg_dump not found — cannot create a pre-migration backup" >&2
    return 1
  fi
  dir="$(migration_backup_dir)"
  mkdir -p "${dir}"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  file="${dir}/migration-backup-${ts}.dump"
  if pg_dump "${DATABASE_URL}" -Fc -f "${file}"; then
    if [[ ! -s "${file}" ]]; then
      echo "[migration-backup] backup file is empty" >&2
      rm -f "${file}"
      return 1
    fi
    echo "${file}"
    prune_migration_backups "${dir}"
    return 0
  fi
  rm -f "${file}" 2>/dev/null || true
  return 1
}

prune_migration_backups() {
  local dir="${1:-$(migration_backup_dir)}"
  local retain="${ARCIIN_MIGRATION_BACKUP_RETAIN:-${MIGRATION_BACKUP_RETAIN:-5}}"
  mapfile -t files < <(find "${dir}" -maxdepth 1 -type f -name 'migration-backup-*.dump' | sort -r)
  local i=0
  for f in "${files[@]}"; do
    i=$((i + 1))
    if (( i > retain )); then
      rm -f "${f}"
    fi
  done
}
