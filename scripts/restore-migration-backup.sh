#!/usr/bin/env bash
# Restore a pre-migration PostgreSQL backup created by arciin-init (ARC-014).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# Honor an already-exported DATABASE_URL so operators/tests cannot be
# silently redirected onto the values in a local .env file.
EXISTING_DATABASE_URL="${DATABASE_URL:-}"
EXISTING_DATA_DIR="${ARCIIN_DATA_DIR:-}"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT_DIR}/.env"
  set +a
fi

DATABASE_URL="${EXISTING_DATABASE_URL:-${DATABASE_URL:-postgresql://arciin:arciin@localhost:5432/arciin}}"
ARCIIN_DATA_DIR="${EXISTING_DATA_DIR:-${ARCIIN_DATA_DIR:-/srv/arciin-storage/arciin}}"
BACKUP_FILE="${1:-}"
NONINTERACTIVE="${ARCIIN_RESTORE_NONINTERACTIVE:-}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 /path/to/migration-backup-YYYYMMDDTHHMMSSZ.dump" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ "${BACKUP_FILE}" != *migration-backup-* ]]; then
  echo "Refusing to restore: file name must look like an automatic migration backup." >&2
  exit 1
fi

if [[ -z "${NONINTERACTIVE}" ]]; then
  read -r -p "This will REPLACE the current database with the backup. Type RESTORE to continue: " confirm
  if [[ "${confirm}" != "RESTORE" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required but was not found." >&2
  exit 1
fi

echo "[restore-migration-backup] Restoring from ${BACKUP_FILE}"
# pg_dump from a newer client may emit SET transaction_timeout (PG 17+).
# Treat that as non-fatal; fail only if the restore produced no schema.
set +e
pg_restore --clean --if-exists --no-owner --no-acl --dbname="${DATABASE_URL}" "${BACKUP_FILE}"
restore_rc=$?
set -e
if ! psql "${DATABASE_URL}" -tAc "SELECT 1 FROM pg_tables WHERE tablename = 'User'" | grep -q 1; then
  echo "[restore-migration-backup] Restore failed: User table is missing (pg_restore exit ${restore_rc})" >&2
  exit 1
fi
echo "[restore-migration-backup] Restore complete."
