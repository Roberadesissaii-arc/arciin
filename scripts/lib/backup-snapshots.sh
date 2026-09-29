#!/usr/bin/env bash
# Which backup directories are complete nightly snapshots.
#
# backup.sh used to take the newest directory matching 20* as rsync's
# --link-dest. A DB-only manual backup named 20260927-175405-… (no storage/)
# sorted last, so the next nightly run had nothing to hard-link against,
# copied all of storage in full, filled the disk and failed partway — leaving
# a partial directory that would itself have been the next run's reference.
#
# A snapshot counts only if it is complete: nightly name (YYYYMMDD-HHMMSS),
# storage/, database.dump and MANIFEST.txt, plus the COMPLETE marker that
# backup.sh writes as its last step. A manifest saying "format: 2" means the
# marker is required; snapshots from before it existed are accepted on
# MANIFEST.txt alone, which was always written last under set -e.
# Anything else — manual-*, named pre-deploy dumps, partial runs — is never a
# link source and is never pruned.

BACKUP_NIGHTLY_NAME_RE='^[0-9]{8}-[0-9]{6}$'

backup_is_nightly_name() {
  [[ "$(basename -- "$1")" =~ ${BACKUP_NIGHTLY_NAME_RE} ]]
}

backup_is_complete_snapshot() {
  local dir="$1"
  backup_is_nightly_name "${dir}" || return 1
  [[ -d "${dir}/storage" && -f "${dir}/database.dump" && -f "${dir}/MANIFEST.txt" ]] || return 1
  # Snapshots written since the marker existed say so in their manifest, and
  # for those the marker is required. Older ones are accepted on the manifest.
  if grep -q '^format: 2$' "${dir}/MANIFEST.txt"; then
    [[ -f "${dir}/COMPLETE" ]] || return 1
  fi
  return 0
}

# Complete nightly snapshots under $1, oldest first, excluding the name in $2.
# Always returns 0: backup.sh runs under `set -euo pipefail`, and a loop whose
# last test failed would otherwise abort the whole backup.
backup_complete_snapshots() {
  local dest="$1" exclude="${2:-}" dir
  while IFS= read -r dir; do
    if [[ -n "${exclude}" && "$(basename -- "${dir}")" == "${exclude}" ]]; then
      continue
    fi
    if backup_is_complete_snapshot "${dir}"; then
      printf '%s\n' "${dir}"
    fi
  done < <(find "${dest}" -maxdepth 1 -mindepth 1 -type d | sort)
  return 0
}

# The newest complete nightly snapshot — the only valid --link-dest source.
backup_latest_complete_snapshot() {
  local all
  all="$(backup_complete_snapshots "$1" "${2:-}")"
  if [[ -n "${all}" ]]; then
    printf '%s\n' "${all}" | tail -1
  fi
  return 0
}

# Complete nightly snapshots beyond the newest $2 — the only prunable ones.
backup_prunable_snapshots() {
  local all
  all="$(backup_complete_snapshots "$1")"
  if [[ -n "${all}" ]]; then
    printf '%s\n' "${all}" | head -n "-$2"
  fi
  return 0
}
