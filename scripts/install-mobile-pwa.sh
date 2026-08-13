#!/usr/bin/env bash
# Clone (if needed) and install Arciin Mobile PWA beside the server repo.
# Usage: bash scripts/install-mobile-pwa.sh
# Env:   ARCIIN_MOBILE_DIR, ARCIIN_MOBILE_REPO, ARCIIN_SERVER_DIR
#        ARCIIN_SUDO_PASSWORD (optional, from web UI — never logged)
#        ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=0|1
set -Eeuo pipefail

SERVER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="${ARCIIN_MOBILE_DIR:-${SERVER_ROOT}/../arciin-app}"
MOBILE_REPO="${ARCIIN_MOBILE_REPO:-https://github.com/Roberadesissaii-arc/arciin-app.git}"
LOG_DIR="${SERVER_ROOT}/logs"
STATUS_FILE="${LOG_DIR}/mobile-install.status"
LOG_FILE="${LOG_DIR}/mobile-install.log"
ASKPASS_DIR=""

mkdir -p "$LOG_DIR"

write_status() {
  echo "$1" >"$STATUS_FILE"
}

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

cleanup_askpass() {
  # Drop password from this process environment immediately.
  unset ARCIIN_SUDO_PASSWORD 2>/dev/null || true
  if [[ -n "${ASKPASS_DIR:-}" && -d "${ASKPASS_DIR}" ]]; then
    rm -rf "${ASKPASS_DIR}" 2>/dev/null || true
  fi
  ASKPASS_DIR=""
}

on_err() {
  write_status "failed"
  log "Install failed at line $1"
  cleanup_askpass
  exit 1
}

trap 'on_err "$LINENO"' ERR

# When the web UI provides a sudo password, wrap sudo so apt steps can run non-interactively.
setup_sudo_from_web() {
  if [[ -z "${ARCIIN_SUDO_PASSWORD:-}" ]]; then
    return 0
  fi

  ASKPASS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/arciin-askpass.XXXXXX")"
  local askpass="${ASKPASS_DIR}/askpass"
  local sudo_wrap="${ASKPASS_DIR}/sudo"

  # Askpass only prints the env password — never write the secret into the script body.
  cat >"${askpass}" <<'EOF'
#!/bin/sh
printf '%s\n' "${ARCIIN_SUDO_PASSWORD-}"
EOF
  chmod 700 "${askpass}"

  # Prefer -A askpass so sudo never tries to read a TTY.
  cat >"${sudo_wrap}" <<EOF
#!/bin/sh
export SUDO_ASKPASS="${askpass}"
exec /usr/bin/sudo -A "\$@"
EOF
  chmod 700 "${sudo_wrap}"

  export PATH="${ASKPASS_DIR}:${PATH}"
  export SUDO_ASKPASS="${askpass}"
  # With credentials available, allow full package install.
  export ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=0
  log "Sudo password provided from web UI (not logged) — system packages enabled"
}

write_status "running"
: >"$LOG_FILE" 2>/dev/null || true
log "Starting Arciin Mobile install"
log "Server root: ${SERVER_ROOT}"
log "Mobile dir:  ${MOBILE_DIR}"

setup_sudo_from_web

if [[ ! -d "${MOBILE_DIR}/.git" ]]; then
  if [[ -e "${MOBILE_DIR}" ]]; then
    log "Path exists but is not a git clone: ${MOBILE_DIR}"
    write_status "failed"
    cleanup_askpass
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

# No password and no TTY → skip apt (desktop install usually already has Node/pnpm).
if [[ -z "${ARCIIN_SUDO_PASSWORD:-}" ]] && [[ ! -t 0 ]]; then
  if [[ -z "${ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES+x}" ]] || [[ "${ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES}" == "1" ]]; then
    export ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=1
    log "Non-interactive, no sudo password — ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=1"
  fi
fi

if [[ "${ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES:-0}" == "1" ]]; then
  log "Skipping mobile system packages (ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=1)"
fi

log "Running mobile install.sh"
bash "${MOBILE_DIR}/install.sh" >>"$LOG_FILE" 2>&1

cleanup_askpass
write_status "done"
log "Arciin Mobile install finished"
