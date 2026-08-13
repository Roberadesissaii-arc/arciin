#!/usr/bin/env bash
# Clone (if needed) and install Arciin Mobile PWA beside the server repo.
# Usage: bash scripts/install-mobile-pwa.sh
# Env:   ARCIIN_MOBILE_DIR, ARCIIN_MOBILE_REPO, ARCIIN_SERVER_DIR
set -Eeuo pipefail

SERVER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="${ARCIIN_MOBILE_DIR:-${SERVER_ROOT}/../arciin-app}"
MOBILE_REPO="${ARCIIN_MOBILE_REPO:-https://github.com/Roberadesissaii-arc/arciin-app.git}"
LOG_DIR="${SERVER_ROOT}/logs"
STATUS_FILE="${LOG_DIR}/mobile-install.status"
LOG_FILE="${LOG_DIR}/mobile-install.log"

mkdir -p "$LOG_DIR"

write_status() {
  echo "$1" >"$STATUS_FILE"
}

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

on_err() {
  write_status "failed"
  log "Install failed at line $1"
  exit 1
}

trap 'on_err "$LINENO"' ERR

write_status "running"
log "Starting Arciin Mobile install"
log "Server root: ${SERVER_ROOT}"
log "Mobile dir:  ${MOBILE_DIR}"

if [[ ! -d "${MOBILE_DIR}/.git" ]]; then
  if [[ -e "${MOBILE_DIR}" ]]; then
    log "Path exists but is not a git clone: ${MOBILE_DIR}"
    write_status "failed"
    exit 1
  fi
  log "Cloning ${MOBILE_REPO} → ${MOBILE_DIR}"
  git clone "${MOBILE_REPO}" "${MOBILE_DIR}" >>"$LOG_FILE" 2>&1
else
  log "Mobile repo already cloned — updating"
  git -C "${MOBILE_DIR}" pull --ff-only >>"$LOG_FILE" 2>&1 || true
fi

export ARCIIN_SERVER_DIR="${ARCIIN_SERVER_DIR:-${SERVER_ROOT}}"
export ARCIIN_MOBILE_SKIP_INSTALL_CHOICE=1
# When launched from the web UI (no TTY), default to skipping apt/sudo unless overridden.
if [[ ! -t 0 ]] && [[ -z "${ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES+x}" ]]; then
  export ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=1
  log "Non-interactive session — ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=1 (no sudo password prompt)"
fi
if [[ "${ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES:-0}" == "1" ]]; then
  log "Skipping mobile system packages (ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=1)"
fi

log "Running mobile install.sh"
bash "${MOBILE_DIR}/install.sh" >>"$LOG_FILE" 2>&1

write_status "done"
log "Arciin Mobile install finished"
