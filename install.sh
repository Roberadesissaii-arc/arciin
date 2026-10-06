#!/usr/bin/env bash
# ================================================================
#  Arciin — Local / WSL Installer
#  Supports: Debian/Ubuntu/WSL (apt)
#  Usage:  bash install.sh                — install, or repair an existing install
#          bash install.sh --repair       — repair/upgrade, keeping all data (default
#                                            when Arciin is already installed)
#          bash install.sh --fresh        — ERASE the Arciin database + config and
#                                            reinstall (typed confirmation)
#          bash install.sh --uninstall    — remove Arciin's services only; data kept
#          bash install.sh --docker       — Docker (canonical production Compose)
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/lib/host-platform.sh
source "${ROOT_DIR}/scripts/lib/host-platform.sh"
# shellcheck source=scripts/lib/storage-defaults.sh
source "${ROOT_DIR}/scripts/lib/storage-defaults.sh"
# shellcheck source=scripts/lib/db-credentials.sh
source "${ROOT_DIR}/scripts/lib/db-credentials.sh"
# shellcheck source=scripts/lib/avahi-discovery.sh
source "${ROOT_DIR}/scripts/lib/avahi-discovery.sh"
# shellcheck source=scripts/lib/install-state.sh
source "${ROOT_DIR}/scripts/lib/install-state.sh"

# apt must never stop to ask a question nobody can see behind a spinner —
# needrestart's "which services should be restarted?" dialog hung fresh
# Ubuntu installs.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

docker_available() {
  command -v docker &>/dev/null && (docker compose version &>/dev/null || command -v docker-compose &>/dev/null)
}

print_docker_hint() {
  echo ""
  echo -e "    ${YELLOW}Tip:${RESET} Use Docker to avoid installing Node, PostgreSQL, and Redis on the host:"
  echo -e "         ${DIM}./install.sh --docker${RESET}  or  ${DIM}./scripts/docker-setup.sh${RESET}"
  echo -e "         ${DIM}See docs/DOCKER.md${RESET}"
  echo ""
}

# ── Mode flags ────────────────────────────────────────────────────────────────
# install (default) → repair when an install already exists.
ARCIIN_MODE="${ARCIIN_MODE:-auto}"
ARCIIN_DELETE_DATA=0
ARCIIN_DELETE_STORAGE=0
ARCIIN_ALLOW_ROOT_STORAGE="${ARCIIN_ALLOW_ROOT_STORAGE:-0}"
ARCIIN_REBUILD=0
for _arg in "$@"; do
  case "$_arg" in
    --docker|-d) ARCIIN_INSTALL_MODE=docker ;;
    --native) ARCIIN_INSTALL_MODE=native ;;
    --repair) ARCIIN_MODE=repair ;;
    --fresh) ARCIIN_MODE=fresh ;;
    # Kept as an alias. It used to drop the database with no confirmation;
    # it now goes through the same typed confirmation as --fresh.
    --reset-db) ARCIIN_MODE=fresh ;;
    --uninstall) ARCIIN_MODE=uninstall ;;
    --delete-data) ARCIIN_DELETE_DATA=1 ;;
    --delete-storage) ARCIIN_DELETE_STORAGE=1 ;;
    --allow-root-storage) ARCIIN_ALLOW_ROOT_STORAGE=1 ;;
    --rebuild) ARCIIN_REBUILD=1 ;;
    --help|-h)
      cat <<'USAGE'
Usage: ./install.sh [mode] [options]

Modes
  (none)                 Install. If Arciin is already installed here, repair it.
  --repair               Repair / upgrade an existing install. Keeps the database,
                         files, instance ID, license, settings and secrets.
  --fresh                Erase the Arciin database and .env, then install again.
                         Shows exactly what will be removed and requires typing
                         ERASE ARCIIN. Your files are NOT deleted (see --delete-storage).
  --uninstall            Stop and remove Arciin's services. Database, files and a
                         backup of .env are kept.
      --delete-data      With --uninstall: also drop the Arciin database and .env
                         (typed confirmation).
      --delete-storage   With --fresh or --uninstall --delete-data: also delete the
                         storage folder (a second, separate typed confirmation).
  --docker               Install with Docker (canonical production Compose).

Options
  --allow-root-storage   Allow a storage path under /mnt or /media to be created on
                         the root filesystem when its disk is not mounted.
  --rebuild              Rebuild the app even if this version is already built.

Environment
  ARCIIN_INSTALL_MODE=docker|native   Same as --docker / --native
  ARCIIN_UPGRADE_SYSTEM=1             Also run apt-get upgrade (off by default)
  ARCIIN_SKIP_SYSTEM_PACKAGES=1       Skip apt (dependencies must exist)
  ARCIIN_SKIP_INSTALL_CHOICE=1        Skip the Docker vs native menu
  ARCIIN_ON_EXISTING_DB=keep          Non-interactive: keep/repair (the default)
  ARCIIN_CONFIRM_ERASE="ERASE ARCIIN" Non-interactive confirmation for --fresh
USAGE
      exit 0
      ;;
  esac
done

if [[ "${ARCIIN_INSTALL_MODE:-}" == "docker" ]]; then
  # Same modes, same meaning: --repair, --fresh, --uninstall, --delete-data,
  # --delete-storage and --allow-root-storage pass straight through.
  _docker_args=()
  for _arg in "$@"; do
    case "$_arg" in --docker|-d|--native|--rebuild) ;; *) _docker_args+=("$_arg") ;; esac
  done
  exec "${ROOT_DIR}/scripts/docker-setup.sh" "${_docker_args[@]}"
fi
DEFAULT_NODE_MAJOR=24
DEFAULT_PNPM_VERSION=10.32.1
DEFAULT_WEB_PORT=3000
DEFAULT_API_PORT=4000
DEFAULT_PG_PORT=5432
ARCIIN_PG_PORT="${DEFAULT_PG_PORT}"
# Set once PM2 boot persistence is actually configured (real systemd only).
ARCIIN_BOOT_PERSISTENT=0

# ── Colors & styling ─────────────────────────────────────────────────────────
BOLD="\033[1m"
GREEN="\033[32m"
BGREEN="\033[1;32m"
YELLOW="\033[33m"
CYAN="\033[36m"
BCYAN="\033[1;36m"
RED="\033[31m"
DIM="\033[2m"
WHITE="\033[97m"
RESET="\033[0m"

TOTAL_STEPS=13
ARCIIN_WEB_PORT="${DEFAULT_WEB_PORT}"
ARCIIN_API_PORT="${DEFAULT_API_PORT}"
STEP=0

step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "  ${BCYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "  ${WHITE}${BOLD}  Step ${STEP}/${TOTAL_STEPS}  ${RESET}${BOLD}$1${RESET}"
  echo -e "  ${BCYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

ok()      { echo -e "    ${GREEN}✔${RESET}  $1"; }
doing()   { echo -ne "    ${CYAN}⟳${RESET}  ${DIM}$1${RESET}"; }
done_()   { echo -ne "\r\033[2K"; echo -e "    ${GREEN}✔${RESET}  $1"; }
warn()    { echo -e "    ${YELLOW}⚠${RESET}  $1"; }
fail()    { echo -e "    ${RED}✖${RESET}  $1"; exit 1; }

# Background spin() steps cannot show a sudo password prompt — authenticate up front.
require_sudo_credentials() {
  if sudo -n true 2>/dev/null; then
    return 0
  fi
  echo ""
  echo -e "  ${YELLOW}Administrator access required${RESET}"
  echo -e "  ${DIM}Native install uses sudo for apt, PostgreSQL, firewall, and PM2 boot setup.${RESET}"
  echo -e "  ${DIM}Steps run in the background, so your password must be cached first.${RESET}"
  if [[ -t 0 ]]; then
    echo ""
    if ! sudo -v; then
      fail "sudo authentication failed"
    fi
    ok "sudo credentials cached"
  else
    echo ""
    echo -e "  ${DIM}Run ${RESET}sudo -v${DIM} in your terminal, then re-run:${RESET}  ./install.sh"
    echo -e "  ${DIM}Or skip host apt if deps exist:${RESET}  ARCIIN_SKIP_SYSTEM_PACKAGES=1 ./install.sh"
    fail "sudo credentials required (no TTY for password prompt)"
  fi
}

LAST_SPIN_LOG=""

on_err() {
  local line="$1" cmd="$2" code="$3"
  echo ""
  echo -e "    ${RED}Installer error at line ${line}${RESET}"
  echo -e "    ${DIM}Command:${RESET} ${cmd}"
  if [[ -n "${LAST_SPIN_LOG:-}" && -f "${LAST_SPIN_LOG:-}" ]]; then
    echo ""
    echo -e "    ${YELLOW}Last step output:${RESET}"
    sed 's/^/    /' "$LAST_SPIN_LOG"
    rm -f "$LAST_SPIN_LOG"
    LAST_SPIN_LOG=""
  fi
  exit "$code"
}

trap 'on_err "$LINENO" "$BASH_COMMAND" "$?"' ERR

spin() {
  local msg="$1"; shift
  local chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
  local start i=0 pid elapsed mins secs c log_file exit_code

  log_file="$(mktemp)"
  LAST_SPIN_LOG="$log_file"
  "$@" >"$log_file" 2>&1 &
  pid=$!
  start=$(date +%s)

  while kill -0 "$pid" 2>/dev/null; do
    elapsed=$(( $(date +%s) - start ))
    mins=$(( elapsed / 60 )); secs=$(( elapsed % 60 ))
    c="${chars:$((i % ${#chars})):1}"
    if (( elapsed >= 2 )); then
      printf "\r    ${CYAN}%s${RESET}  ${DIM}%s — %d:%02d${RESET}   " "$c" "$msg" "$mins" "$secs"
    else
      printf "\r    ${CYAN}%s${RESET}  ${DIM}%s${RESET}   " "$c" "$msg"
    fi
    i=$(( i + 1 ))
    sleep 0.15
  done

  wait "$pid"
  exit_code=$?
  printf "\r\033[2K"
  if [[ $exit_code -eq 0 ]]; then
    rm -f "$log_file"
    LAST_SPIN_LOG=""
  fi
  return $exit_code
}

report_spin_failure() {
  local label="$1"
  echo ""
  echo -e "    ${RED}Step failed:${RESET} $label"
  if [[ -n "${LAST_SPIN_LOG:-}" && -f "${LAST_SPIN_LOG:-}" ]]; then
    echo ""
    echo -e "    ${YELLOW}Command output:${RESET}"
    sed 's/^/    /' "$LAST_SPIN_LOG"
    rm -f "$LAST_SPIN_LOG"
    LAST_SPIN_LOG=""
  fi
  fail "$label failed"
}

spin_ok() {
  local label="$1" done_msg="$2"; shift 2
  if spin "$label" "$@"; then
    done_ "$done_msg"
  else
    report_spin_failure "$label"
  fi
}

wait_for_apt_lock() {
  local max_wait="${1:-180}" elapsed=0
  while (( elapsed < max_wait )); do
    if ! sudo fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$(( elapsed + 1 ))
  done
  return 1
}

apt_get_install() {
  local max_attempts=5 attempt
  for (( attempt = 1; attempt <= max_attempts; attempt++ )); do
    wait_for_apt_lock || return 1
    if sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -qq "$@"; then
      return 0
    fi
    if (( attempt < max_attempts )); then
      sleep $(( attempt * 2 ))
    fi
  done
  return 1
}

install_nodejs_nodesource() {
  local major="$1"
  curl -fsSL "https://deb.nodesource.com/setup_${major}.x" | sudo bash -
  wait_for_apt_lock || return 1
  apt_get_install nodejs
}

# ── Flags ─────────────────────────────────────────────────────────────────────
RESET_DB=false
[[ "$ARCIIN_MODE" == "fresh" ]] && RESET_DB=true
# claimed | partial | unclaimed | unknown — set during Postgres setup
ARCIIN_DB_CLAIM_STATE="unknown"

# ── Banner ────────────────────────────────────────────────────────────────────
# Only on a terminal: with no usable TERM (cloud-init, CI, `ssh host cmd`)
# `clear` fails and the ERR trap used to abort the whole install here.
if [[ -t 1 ]]; then clear 2>/dev/null || true; fi
echo ""
echo -e "${BGREEN}     █████╗ ██████╗  ██████╗██╗██╗███╗   ██╗${RESET}"
echo -e "${BGREEN}    ██╔══██╗██╔══██╗██╔════╝██║██║████╗  ██║${RESET}"
echo -e "${BGREEN}    ███████║██████╔╝██║     ██║██║██╔██╗ ██║${RESET}"
echo -e "${BGREEN}    ██╔══██║██╔══██╗██║     ██║██║██║╚██╗██║${RESET}"
echo -e "${BGREEN}    ██║  ██║██║  ██║╚██████╗██║██║██║ ╚████║${RESET}"
echo -e "${BGREEN}    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝╚═╝╚═╝  ╚═══╝${RESET}"
echo ""
echo -e "  ${DIM}Your server, your control.${RESET}                          ${DIM}self-hosted${RESET}"
echo -e "  ${DIM}──────────────────────────────────────────────────────────${RESET}"
if $RESET_DB; then
  echo ""
  echo -e "  ${YELLOW}${BOLD}⚠  Reset mode — PostgreSQL database \"arciin\" will be dropped.${RESET}"
fi
echo ""

# ── Port helpers ──────────────────────────────────────────────────────────────
# lsof alone can miss listeners (permissions / timing). Prefer ss + a bind probe.
_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnH "sport = :${port}" 2>/dev/null | grep -q .; then
      return 0
    fi
  fi
  if lsof -iTCP:"${port}" -sTCP:LISTEN &>/dev/null 2>&1; then
    return 0
  fi
  return 1
}

_port_bind_test_free() {
  local port="$1"
  command -v node >/dev/null 2>&1 || return 0
  node -e "
    const net = require('net');
    const s = net.createServer();
    s.once('error', () => process.exit(1));
    s.once('listening', () => { s.close(() => process.exit(0)); });
    s.listen(${port}, '0.0.0.0');
  " &>/dev/null
}

_port_available() {
  local port="$1"
  ! _port_in_use "$port" && _port_bind_test_free "$port"
}

_port_listener_hint() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tlnpH "sport = :${port}" 2>/dev/null | head -3 | sed 's/^/      /' || true
  fi
  lsof -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -3 | sed 's/^/      /' || true
}

_find_free_port() {
  local start_port="${1:-3000}"
  local end_port="${2:-3099}"
  local port="$start_port"
  while (( port <= end_port )); do
    if _port_available "$port"; then
      echo "$port"
      return 0
    fi
    port=$(( port + 1 ))
  done
  echo "$start_port"
}

_apply_app_ports_to_env() {
  local env_file="$1" lan_ip="$2" web_port="$3" api_port="$4"
  _set_env_kv "$env_file" "NODE_ENV" "production"
  _set_env_kv "$env_file" "PORT" "${web_port}"
  _set_env_kv "$env_file" "ARCIIN_WEB_PORT" "${web_port}"
  _set_env_kv "$env_file" "ARCIIN_BIND_HOST" "0.0.0.0"
  _set_env_kv "$env_file" "ARCIIN_PUBLIC_URL" "http://${lan_ip}:${web_port}"
  _set_env_kv "$env_file" "ARCIIN_API_URL" "http://127.0.0.1:${api_port}"
  _set_env_kv "$env_file" "API_PORT" "${api_port}"
  # Keep empty so the browser uses the page origin for /api (session cookies + avatars; avoids hydration mismatches).
  _set_env_kv "$env_file" "NEXT_PUBLIC_ARCIIN_API_ORIGIN" ""
  _set_env_kv "$env_file" "NEXT_PUBLIC_SOCKET_URL" ""
  _set_env_kv "$env_file" "NEXT_PUBLIC_API_BASE_URL" "/api"
  _set_env_kv "$env_file" "NEXT_PUBLIC_ARCIIN_PUBLIC_URL" "http://${lan_ip}:${web_port}"
  if ! grep -q '^ARCIIN_DATA_DIR=' "$env_file" 2>/dev/null; then
    _set_env_kv "$env_file" "ARCIIN_DATA_DIR" "$ARCIIN_DEFAULT_STORAGE"
  fi
  if ! grep -q '^MAX_UPLOAD_SIZE_MB=' "$env_file" 2>/dev/null; then
    _set_env_kv "$env_file" "MAX_UPLOAD_SIZE_MB" "20480"
  fi
  ARCIIN_WEB_PORT="$web_port"
  ARCIIN_API_PORT="$api_port"
  export ARCIIN_WEB_PORT ARCIIN_API_PORT
}

# Re-check immediately before PM2 — other apps (Arceclaw, pnpm dev) may have taken the port.
finalize_ports_before_launch() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "$env_file" ]] || return 0

  local lan_ip web_port api_port saved_web saved_api changed=false
  lan_ip="$(_detect_lan_ip)"
  web_port="${ARCIIN_WEB_PORT:-$(_env_public_url_port "$env_file")}"
  web_port="${web_port:-${DEFAULT_WEB_PORT}}"
  api_port="${ARCIIN_API_PORT:-$(grep -oP '(?<=^API_PORT=)\d+' "$env_file" 2>/dev/null || echo "${DEFAULT_API_PORT}")}"

  saved_web="$web_port"
  saved_api="$api_port"

  while ! _port_available "$web_port"; do
    warn "Web port ${web_port} is taken — trying $((web_port + 1))"
    _port_listener_hint "$web_port"
    web_port=$((web_port + 1))
    changed=true
  done

  while ! _port_available "$api_port"; do
    warn "API port ${api_port} is taken — trying $((api_port + 1))"
    _port_listener_hint "$api_port"
    api_port=$((api_port + 1))
    changed=true
  done

  if $changed || [[ "$web_port" != "${ARCIIN_WEB_PORT:-}" ]] || [[ "$api_port" != "${ARCIIN_API_PORT:-}" ]]; then
    _apply_app_ports_to_env "$env_file" "$lan_ip" "$web_port" "$api_port"
    # shellcheck source=scripts/lib/open-firewall-ports.sh
    if [[ -f "${ROOT_DIR}/scripts/lib/open-firewall-ports.sh" ]]; then
      source "${ROOT_DIR}/scripts/lib/open-firewall-ports.sh"
      arciin_open_firewall_ports "$web_port" "$api_port" || true
    elif command -v ufw >/dev/null 2>&1; then
      sudo ufw allow "${web_port}/tcp" comment "Arciin web UI" &>/dev/null || true
      sudo ufw allow "${api_port}/tcp" comment "Arciin API (LAN scripts)" &>/dev/null || true
    fi
    ok "Ports finalized for launch — web ${web_port}, API ${api_port}"
  fi
}

_port_has_postgres() {
  command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p "$1" -q 2>/dev/null
}

# Prefer 5432; if busy and not PostgreSQL, try 5433, 5434, …
_resolve_postgres_port() {
  local port="${DEFAULT_PG_PORT}"
  local end_port=5499
  while (( port <= end_port )); do
    if _port_has_postgres "$port"; then
      echo "$port"
      return 0
    fi
    if ! _port_in_use "$port"; then
      echo "$port"
      return 0
    fi
    port=$(( port + 1 ))
  done
  echo "${DEFAULT_PG_PORT}"
}

maybe_reconfigure_postgresql_port() {
  local target_port="$1"
  if _port_has_postgres "$target_port"; then
    return 0
  fi

  local pg_conf=""
  if [[ -d /etc/postgresql ]]; then
    pg_conf="$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1 || true)"
  fi
  if [[ -z "$pg_conf" ]]; then
    warn "postgresql.conf not found — ensure PostgreSQL listens on port ${target_port}"
    return 0
  fi

  if _port_in_use "$target_port"; then
    warn "Port ${target_port} is in use — cannot reconfigure PostgreSQL"
    return 1
  fi

  warn "Port ${DEFAULT_PG_PORT} is in use — configuring PostgreSQL to listen on ${target_port}"
  if grep -qE '^[#\s]*port\s*=' "$pg_conf"; then
    sudo sed -i "s/^[#[:space:]]*port[[:space:]]*=.*/port = ${target_port}/" "$pg_conf"
  else
    echo "port = ${target_port}" | sudo tee -a "$pg_conf" >/dev/null
  fi
  sudo systemctl restart postgresql 2>/dev/null || sudo service postgresql restart 2>/dev/null || true
  sleep 2
  _port_has_postgres "$target_port" || warn "PostgreSQL is not responding on port ${target_port} yet"
}

_set_env_kv() {
  local env_file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >>"$env_file"
  fi
}

_detect_lan_ip() {
  # Prefer RFC1918 that is not loopback, link-local, or Docker's default bridge.
  # Do not use hostname -I's first address — that is often a container IP.
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^127\./) continue
      if ($i ~ /^169\.254\./) continue
      if ($i ~ /^172\.17\./) continue
      if ($i ~ /^192\.168\./) { print $i; exit }
    }
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^10\./) { print $i; exit }
    }
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^172\.(1[6-9]|2[0-9]|3[0-1])\./ && $i !~ /^172\.17\./) { print $i; exit }
    }
  }')"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return
  fi
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") { print $(i+1); exit }}')"
  if [[ -n "$ip" && "$ip" != 127.* && "$ip" != 172.17.* && "$ip" != 169.254.* ]]; then
    echo "$ip"
    return
  fi
  echo "127.0.0.1"
}

_env_public_url_port() {
  # No ARCIIN_PUBLIC_URL (a Docker or partial .env) is "no port", not an error.
  { grep '^ARCIIN_PUBLIC_URL=' "$1" 2>/dev/null || true; } | sed -n 's|.*:\([0-9][0-9]*\)$|\1|p' | head -1
}

# Port reserved for ../arciin-app mobile PWA (avoid desktop web stealing it on reinstall).
_reserved_mobile_pwa_port() {
  local mobile_env="${ROOT_DIR}/../arciin-app/.env.local"
  local port
  port="$(grep -oP '(?<=^ARCIIN_MOBILE_PORT=)\d+' "${ROOT_DIR}/.env" 2>/dev/null | head -1 || true)"
  if [[ -n "$port" ]]; then
    echo "$port"
    return 0
  fi
  [[ -f "$mobile_env" ]] || return 1
  port="$(grep -oP '(?<=^ARCIIN_MOBILE_PORT=)\d+' "$mobile_env" 2>/dev/null | head -1 || true)"
  if [[ -n "$port" ]]; then
    echo "$port"
    return 0
  fi
  port="$(_env_public_url_port "$mobile_env")"
  [[ -n "$port" ]] && echo "$port"
}

configure_app_ports() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "$env_file" ]] || return 0

  local web_port api_port lan_ip saved_web_port saved_api mobile_port
  lan_ip="$(_detect_lan_ip)"
  web_port="$(_find_free_port "$DEFAULT_WEB_PORT" 3099)"
  api_port="$(_find_free_port "$DEFAULT_API_PORT" 4099)"
  mobile_port="$(_reserved_mobile_pwa_port 2>/dev/null || true)"

  saved_web_port="$(_env_public_url_port "$env_file")"
  saved_api="$(grep -oP '(?<=^API_PORT=)\d+' "$env_file" 2>/dev/null || true)"

  if [[ -n "$saved_web_port" ]] && _port_available "$saved_web_port"; then
    web_port="$saved_web_port"
  elif [[ -n "$saved_web_port" ]]; then
    warn "Web port $saved_web_port is in use — switching to $web_port"
  fi

  if [[ -n "$mobile_port" && "$web_port" == "$mobile_port" ]]; then
    warn "Web port ${web_port} is reserved for Arciin Mobile — finding next free port"
    web_port="$(_find_free_port "$((mobile_port + 1))" 3099)"
  fi

  if [[ -n "$saved_api" ]] && _port_available "$saved_api"; then
    api_port="$saved_api"
  elif [[ -n "$saved_api" ]]; then
    warn "API port $saved_api is in use — switching to $api_port"
  fi

  _apply_app_ports_to_env "$env_file" "$lan_ip" "$web_port" "$api_port"

  ok "Web UI (LAN)   → http://${lan_ip}:${web_port}"
  ok "Web UI (local) → http://localhost:${web_port}"
  ok "API (LAN)      → http://${lan_ip}:${api_port}"
  ok "API (local)    → http://127.0.0.1:${api_port}"
  if [[ -n "$mobile_port" ]]; then
    ok "Mobile PWA       → port ${mobile_port} (../arciin-app)"
  fi
}

ensure_production_secrets() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "$env_file" ]] || return 0

  _set_env_kv "$env_file" "NODE_ENV" "production"

  local secret_len
  # A missing key must not end the install: under pipefail a grep with no
  # match fails the whole assignment (an .env from Docker or a stopped run).
  secret_len="$({ grep '^SESSION_SECRET=' "$env_file" 2>/dev/null || true; } | cut -d= -f2- | wc -c | tr -d ' ')"
  if grep -q '^SESSION_SECRET=change-this-in-production' "$env_file" 2>/dev/null \
    || [[ "${secret_len:-0}" -lt 32 ]]; then
    _set_env_kv "$env_file" "SESSION_SECRET" "$(_gen_secret)"
    ok "SESSION_SECRET secured (random)"
  fi

  if grep -qE '^ARCIIN_SETUP_TOKEN=(dev-token)?$' "$env_file" 2>/dev/null \
    || ! grep -q '^ARCIIN_SETUP_TOKEN=.' "$env_file" 2>/dev/null; then
    _set_env_kv "$env_file" "ARCIIN_SETUP_TOKEN" "$(openssl rand -hex 24 2>/dev/null || _gen_secret)"
    ok "ARCIIN_SETUP_TOKEN secured (random)"
  fi

  # Entitlement tokens are Ed25519-signed by the licensing authority and
  # verified with a public key that ships in the Arciin source, so there is
  # nothing to mint here. This used to generate a random
  # ARCIIN_LICENSE_VERIFY_SECRET, which was worse than useless: the old format
  # signed with a *shared* secret, so a per-install random value could never
  # match the vendor's and hosted activation always failed. Strip the stale
  # value out of upgraded installs rather than leaving it to be puzzled over.
  if grep -q '^ARCIIN_LICENSE_VERIFY_SECRET=' "$env_file" 2>/dev/null; then
    sed -i '/^ARCIIN_LICENSE_VERIFY_SECRET=/d' "$env_file" 2>/dev/null \
      && ok "Removed obsolete ARCIIN_LICENSE_VERIFY_SECRET (licensing now uses public-key verification)"
  fi

  # Dedicated key for encrypting the credential vault / webhooks / integrations
  # at rest, independent of SESSION_SECRET. Only minted on a FRESH install — on
  # an existing instance the code falls back to the SESSION_SECRET-derived key,
  # so we must not introduce a new key that can't decrypt existing data.
  if [[ "${ARCIIN_FRESH_INSTALL:-0}" == "1" ]] \
    && ! grep -q '^ARCIIN_ENCRYPTION_KEY=[0-9a-fA-F]\{64\}$' "$env_file" 2>/dev/null; then
    _set_env_kv "$env_file" "ARCIIN_ENCRYPTION_KEY" "$(openssl rand -hex 32 2>/dev/null || _gen_secret)"
    ok "ARCIIN_ENCRYPTION_KEY secured (random)"
  fi

  chmod 600 "$env_file" 2>/dev/null && ok ".env readable only by you (chmod 600)" || true
}

configure_firewall() {
  local env_file="${ROOT_DIR}/.env"
  local web_port="${ARCIIN_WEB_PORT:-$(_env_public_url_port "$env_file")}"
  web_port="${web_port:-${DEFAULT_WEB_PORT}}"
  local api_port="${ARCIIN_API_PORT:-$(grep -oP '(?<=^API_PORT=)\d+' "$env_file" 2>/dev/null || echo "${DEFAULT_API_PORT}")}"
  api_port="${api_port:-${DEFAULT_API_PORT}}"

  # shellcheck source=scripts/lib/open-firewall-ports.sh
  source "${ROOT_DIR}/scripts/lib/open-firewall-ports.sh"

  while ! _port_available "$web_port"; do
    warn "Port ${web_port} is in use — trying next port"
    _port_listener_hint "$web_port"
    web_port=$((web_port + 1))
  done

  if [[ "$web_port" != "${ARCIIN_WEB_PORT}" ]]; then
    _apply_app_ports_to_env "$env_file" "$(_detect_lan_ip)" "$web_port" "$api_port"
    warn "Updated web port to ${web_port} in .env"
  fi

  # Collect ports: web + API + Docker HTTP + optional mobile + account/license platform ports
  local -a ports=()
  mapfile -t ports < <(arciin_collect_standard_ports "$env_file")
  ports+=("$web_port" "$api_port")

  echo ""
  echo -e "  ${BOLD}Firewall${RESET} ${DIM}(so browsers on your LAN can reach Arciin)${RESET}"
  arciin_open_firewall_ports "${ports[@]}"
  ok "Firewall rules applied for web ${web_port}, API ${api_port}, and platform ports if enabled"
  echo -e "    ${DIM}Skip with ARCIIN_SKIP_FIREWALL=1 · platform ports 3010/4100 with ARCIIN_OPEN_PLATFORM_PORTS=0 to disable${RESET}"
}

# Dev-server PIDs that belong to *this* checkout, never anyone else's.
#
# `pkill -f "next dev"` matched on command text alone, so it reached across the
# whole machine: another project's dev server, or the isolated E2E stack, both
# of which merely happen to run the same command. Matching on the process's
# working directory keeps the intent — clear our own dev servers off the
# production ports — without the blast radius. The E2E stack is skipped too: it
# lives on its own ports and blocks nothing.
arciin_own_dev_server_pids() {
  local -a found=()
  local pid cwd
  local e2e_web="${E2E_WEB_PORT:-3300}"
  local e2e_api="${E2E_API_PORT:-4300}"

  for pid in $(pgrep -f "next dev" 2>/dev/null) $(pgrep -f "tsx watch" 2>/dev/null); do
    # Never ourselves: this script's own command line contains those patterns,
    # so a text match happily returns the shell doing the matching.
    [[ "$pid" == "$$" || "$pid" == "$PPID" ]] && continue
    # Only real node processes, not a shell that merely mentions the pattern.
    [[ "$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)" == *node* ]] || continue
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    [[ -z "$cwd" ]] && continue
    # Only processes started from inside this repository.
    [[ "$cwd" == "$ROOT_DIR" || "$cwd" == "$ROOT_DIR"/* ]] || continue
    # Leave the isolated test stack alone.
    if ss -ltnp 2>/dev/null | grep -q "pid=${pid}," ; then
      if ss -ltnp 2>/dev/null | grep "pid=${pid}," | grep -qE ":(${e2e_web}|${e2e_api})\b"; then
        continue
      fi
    fi
    found+=("$pid")
  done
  printf '%s\n' "${found[@]:-}"
}

stop_dev_servers() {
  local -a pids=()
  mapfile -t pids < <(arciin_own_dev_server_pids)
  # mapfile can yield a single empty element when nothing matched.
  [[ ${#pids[@]} -eq 0 || -z "${pids[0]}" ]] && return 0

  warn "Stopping pnpm dev (it blocks production ports)..."
  kill "${pids[@]}" 2>/dev/null || true
  sleep 2
  ok "Dev servers stopped"
}

stop_existing_arciin() {
  stop_dev_servers
  if command -v pm2 &>/dev/null; then
    pm2 stop arciin-web arciin-api arciin-worker &>/dev/null || true
    pm2 delete arciin-web arciin-api arciin-worker &>/dev/null || true
    sleep 1
  fi
  rm -f "${ROOT_DIR}/apps/web/.next/dev/lock" 2>/dev/null || true
}

wait_for_api_health() {
  local port="${ARCIIN_API_PORT:-4000}"
  local tries=45
  local log_file="${ROOT_DIR}/logs/arciin-api-err.log"

  while (( tries > 0 )); do
    if curl -sf "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      ok "API health OK on 127.0.0.1:${port}"
      return 0
    fi
    if pm2 describe arciin-api 2>/dev/null | grep -q "errored"; then
      break
    fi
    tries=$((tries - 1))
    sleep 1
  done

  warn "API did not respond on 127.0.0.1:${port}/api/health"
  if [[ -f "$log_file" ]]; then
    echo -e "    ${DIM}── arciin-api errors (last 15 lines) ──${RESET}"
    tail -15 "$log_file" 2>/dev/null | sed 's/^/    /' || true
  fi
  echo -e "    ${DIM}Fix:${RESET} pm2 logs arciin-api --lines 30"
  return 1
}

# Global npm installs land in npm's prefix. On a stock NodeSource Ubuntu that
# is /usr, owned by root, so `npm install -g pm2` as the installing user died
# with EACCES at the very end of an install. Use sudo exactly when the prefix
# is not ours.
ensure_pm2() {
  if command -v pm2 &>/dev/null; then
    ok "PM2 $(pm2 --version 2>/dev/null | tail -1) already installed"
    return 0
  fi
  local prefix
  prefix="$(npm config get prefix 2>/dev/null || echo /usr)"
  if [[ -w "${prefix}/lib/node_modules" || ( ! -e "${prefix}/lib/node_modules" && -w "${prefix}" ) ]]; then
    spin_ok "Installing PM2 process manager..." "PM2 installed" npm install -g pm2
  else
    spin_ok "Installing PM2 process manager (system-wide)..." "PM2 installed" sudo npm install -g pm2
  fi
  hash -r
  command -v pm2 &>/dev/null || arciin_fail_report "PM2 was installed but is not on PATH" \
    "npm placed pm2 in ${prefix}/bin, which this shell does not search." \
    "Arciin's database and files are set up; only the process manager is missing." \
    "Add ${prefix}/bin to PATH (e.g. in ~/.profile), open a new shell, run ./install.sh --repair"
  ok "PM2 $(pm2 --version 2>/dev/null | tail -1) ready"
}

# Boot persistence is proven, not assumed: the systemd unit must be enabled and
# the saved process list must contain Arciin. If either fails, say so — an
# install that silently does not come back after a reboot is the bug.
ensure_pm2_boot() {
  local user unit pm2_bin node_dir
  user="$(id -un)"
  unit="pm2-${user}"
  pm2_bin="$(command -v pm2)"
  node_dir="$(dirname "$(command -v node)")"
  pm2 save --force >/dev/null 2>&1 || true
  if ! sudo env PATH="${PATH}:${node_dir}" "$pm2_bin" startup systemd -u "$user" --hp "$HOME" >/dev/null 2>&1; then
    arciin_fail_report "Could not register Arciin to start on boot" \
      "'pm2 startup systemd' failed, so a reboot would leave Arciin stopped." \
      "Arciin is installed and running now; your data is fine." \
      "Run: sudo env PATH=\$PATH:${node_dir} ${pm2_bin} startup systemd -u ${user} --hp ${HOME}" \
      "Then: pm2 save — or run ./install.sh --repair"
  fi
  pm2 save --force >/dev/null 2>&1 || true
  if [[ "$(systemctl is-enabled "$unit" 2>/dev/null)" != "enabled" ]]; then
    arciin_fail_report "Boot service ${unit} is not enabled" \
      "pm2 startup ran, but systemd does not report ${unit} as enabled." \
      "Arciin is running now; your data is fine." \
      "sudo systemctl enable ${unit}" "Then run: bash scripts/arciin-doctor.sh"
  fi
  local dump="${PM2_HOME:-$HOME/.pm2}/dump.pm2" name missing=""
  for name in arciin-api arciin-worker arciin-web; do
    grep -q "\"name\":\s*\"${name}\"" "$dump" 2>/dev/null || missing+=" ${name}"
  done
  if [[ -n "$missing" ]]; then
    arciin_fail_report "PM2's saved process list is missing:${missing}" \
      "On reboot PM2 restores only what was saved." \
      "Arciin is running now; your data is fine." "pm2 save --force" "Then: bash scripts/arciin-doctor.sh"
  fi
  ok "Starts on boot: ${unit} enabled, Arciin in PM2's saved list"
  arciin_journal_step "boot"
}

launch_pm2() {
  ensure_pm2

  stop_existing_arciin

  finalize_ports_before_launch

  mkdir -p "${ROOT_DIR}/logs"
  chmod 700 "${ROOT_DIR}/logs" 2>/dev/null || true

  # A build for this exact commit is reused on resume or repair; anything else
  # is rebuilt. Build output lives in the working tree, so the commit is the key.
  local head built
  head="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || echo none)"
  built="$(arciin_journal_get buildSha)"
  if [[ "$ARCIIN_REBUILD" != "1" && "$built" == "$head" && "$head" != "none" \
        && -s "${ROOT_DIR}/apps/api/dist/index.js" && -s "${ROOT_DIR}/apps/worker/dist/index.js" \
        && -f "${ROOT_DIR}/apps/web/.next/BUILD_ID" ]] \
     && git -C "${ROOT_DIR}" diff --quiet HEAD -- 2>/dev/null; then
    ok "Production build for ${head:0:7} already present — reusing it (--rebuild to force)"
  else
    spin_ok "Building production bundles (web, API, worker)..." "Production build ready" \
      bash -c "cd \"${ROOT_DIR}\" && pnpm build"
    promote_web_build
    arciin_journal_set "buildSha" "$head"
  fi
  arciin_journal_step "build"

  spin_ok "Starting Arciin (PM2)..." "PM2 processes started" \
    bash -c "cd \"${ROOT_DIR}\" && pm2 start ecosystem.config.cjs --update-env && pm2 save --force"

  wait_for_api_health || warn "Web UI may show 'waiting for API' until arciin-api is fixed"

  if has_systemd; then
    ensure_pm2_boot
    ARCIIN_BOOT_PERSISTENT=1
  elif is_wsl; then
    # Claiming auto-start here would be false twice over: systemd is off, and
    # WSL itself does not launch when Windows boots.
    warn "WSL detected — Arciin will not start automatically"
    echo -e "    ${DIM}WSL does not start with Windows, and systemd is off by default.${RESET}"
    echo -e "    ${DIM}After each Windows restart, open your WSL terminal and run:${RESET} ${BOLD}bash start.sh${RESET}"
    echo -e "    ${DIM}To enable systemd: add [boot]\\nsystemd=true to /etc/wsl.conf, then 'wsl --shutdown' in PowerShell.${RESET}"
  else
    warn "No systemd — Arciin will not start automatically on boot (run: bash start.sh)"
  fi

  sleep 3
  if pm2 describe arciin-web 2>/dev/null | grep -q "online"; then
    ok "Arciin web is online on port ${ARCIIN_WEB_PORT} (0.0.0.0)"
  else
    echo ""
    warn "Arciin web did not stay online — common cause: port ${ARCIIN_WEB_PORT} already in use"
    _port_listener_hint "${ARCIIN_WEB_PORT}"
    echo -e "    ${DIM}Fix:${RESET} stop other apps on that port, then: ${DIM}bash install.sh${RESET} or ${DIM}pm2 restart all${RESET}"
    echo -e "    ${DIM}Logs:${RESET} pm2 logs arciin-web --lines 20"
    echo -e "    ${DIM}Ports:${RESET} bash scripts/port-status.sh"
  fi

  if ! pm2 describe arciin-api 2>/dev/null | grep -q "online"; then
    warn "arciin-api is not online — check: pm2 logs arciin-api (port ${ARCIIN_API_PORT} may be in use)"
  fi
  arciin_journal_step "launch"
}

configure_postgres_port() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "$env_file" ]] || return 0

  local pg_port saved_pg
  pg_port="$(_resolve_postgres_port)"
  saved_pg="$(grep -oP '(?<=@localhost:)\d+(?=/arciin)' "$env_file" 2>/dev/null || true)"

  if [[ -n "$saved_pg" ]] && { _port_has_postgres "$saved_pg" || ! _port_in_use "$saved_pg"; }; then
    pg_port="$saved_pg"
  elif [[ -n "$saved_pg" ]] && _port_in_use "$saved_pg" && ! _port_has_postgres "$saved_pg"; then
    warn "PostgreSQL port $saved_pg is in use — switching to $pg_port"
  fi

  maybe_reconfigure_postgresql_port "$pg_port"
  ARCIIN_PG_PORT="$pg_port"

  local password="" encoded="" existing_url="" user="arciin" host="localhost" db="arciin"
  local env_backup
  env_backup="$(dirname "$(arciin_journal_path)")/env-backups/latest.env"
  existing_url="$(arciin_read_env_database_url "$env_file" 2>/dev/null || true)"
  if ! arciin_resolve_db_password_into password "$env_file" "${ARCIIN_FRESH_INSTALL:-0}" "$env_backup"; then
    arciin_fail_report "Could not create a database password." \
      "Neither openssl nor /dev/urandom is available to generate one." \
      "Nothing was changed." \
      "Install openssl (sudo apt-get install -y openssl) and re-run ./install.sh"
  fi
  case "${ARCIIN_DB_PASSWORD_SOURCE}" in
    env) [[ "${ARCIIN_FRESH_INSTALL:-0}" == "1" ]] || ok "Existing database credentials kept" ;;
    backup) ok "Database password recovered from the previous .env backup" ;;
    generated)
      if [[ "${ARCIIN_FRESH_INSTALL:-0}" != "1" ]]; then
        # An existing .env without a usable DATABASE_URL: typical after a
        # Docker install (Compose builds the URL itself) or a run that stopped
        # half-way. Keep a copy before rewriting it.
        local saved
        saved="$(dirname "$(arciin_journal_path)")/env-backups/pre-credentials-$(date -u +%Y%m%dT%H%M%SZ).env"
        mkdir -p "$(dirname "$saved")" && install -m 600 "$env_file" "$saved" 2>/dev/null || true
        case "${ARCIIN_DB_URL_STATE}" in
          missing) warn ".env has no DATABASE_URL (it may come from a Docker install)" ;;
          malformed) warn "DATABASE_URL in .env could not be read" ;;
          placeholder) warn "DATABASE_URL in .env still holds the example password" ;;
        esac
        warn "A new database password was generated. An existing 'arciin' role is re-aligned to it below — no data changes. Previous .env saved to ${saved}"
      fi
      ;;
  esac
  encoded="$(arciin_urlencode_db_password "$password")" || arciin_fail_report \
    "Could not encode the database password for DATABASE_URL." \
    "Neither python3 nor node is available to URL-encode it." "Nothing was changed." \
    "Install python3 and re-run ./install.sh"
  if [[ -n "$existing_url" ]]; then
    local parsed
    parsed="$(arciin_parse_database_url "$existing_url" || true)"
    if [[ -n "$parsed" ]]; then
      user="$(printf '%s' "$parsed" | awk -F'\t' '{print $1}')"
      host="$(printf '%s' "$parsed" | awk -F'\t' '{print $3}')"
      db="$(printf '%s' "$parsed" | awk -F'\t' '{print $5}')"
      [[ -n "$user" ]] || user="arciin"
      [[ -n "$host" ]] || host="localhost"
      [[ -n "$db" ]] || db="arciin"
      # A Docker .env names the Compose service; natively it is this machine.
      if [[ "$host" == "postgres" || "$host" == "db" ]]; then host="localhost"; fi
    fi
  fi
  _set_env_kv "$env_file" "DATABASE_URL" "$(arciin_format_database_url "$user" "$encoded" "$host" "$pg_port" "$db")"
  _set_env_kv "$env_file" "ARCIIN_PG_PORT" "${pg_port}"
  arciin_restrict_env_perms "$env_file"
  ARCIIN_DB_PASSWORD="$password"
  if [[ "${ARCIIN_FRESH_INSTALL:-0}" == "1" && "${ARCIIN_DB_PASSWORD_SOURCE}" == "generated" ]]; then
    ok "Database credentials generated successfully."
  fi

  if pg_isready -h localhost -p "$pg_port" &>/dev/null 2>&1; then
    ok "PostgreSQL → localhost:${pg_port}"
  else
    warn "PostgreSQL is not responding on localhost:${pg_port}"
  fi
}

# `pnpm build:web` builds into apps/web/.next-build so a live server is never
# served a half-written build (scripts/deploy-web.sh). The installer never
# swapped it into .next, so arciin-web on a native install found no BUILD_ID
# and restarted forever. Verify, then swap — the same steps as deploy-web.sh.
promote_web_build() {
  local web="${ROOT_DIR}/apps/web"
  local stage="${web}/.next-build" live="${web}/.next" prev="${web}/.next-prev"
  if [[ ! -f "${stage}/BUILD_ID" ]]; then
    [[ -f "${live}/BUILD_ID" ]] && return 0
    arciin_fail_report "The web build is incomplete." \
      "pnpm build finished without a BUILD_ID in apps/web/.next-build." \
      "Nothing was changed; your data is untouched." \
      "Re-run: ./install.sh --rebuild" "Check free memory: the web build needs ~3 GB"
  fi
  node "${ROOT_DIR}/scripts/verify-web-assets.mjs" --dist "$stage" >/dev/null 2>&1 \
    || arciin_fail_report "The web build is incomplete." \
      "scripts/verify-web-assets.mjs rejected apps/web/.next-build." \
      "Nothing was changed; your data is untouched." "Re-run: ./install.sh --rebuild"
  rm -rf "$prev"
  [[ -d "$live" ]] && mv "$live" "$prev"
  mv "$stage" "$live"
  rm -rf "$prev"
}

_gen_secret() {
  openssl rand -base64 32 2>/dev/null | tr -d '\n=' || \
    head -c 32 /dev/urandom | base64 2>/dev/null | tr -d '\n=' || \
    echo "changeme-$(date +%s)-$(( RANDOM * RANDOM ))"
}

# A missing .env next to an existing Arciin database is the classic "lost the
# config" case: minting fresh secrets would orphan encrypted vault data and
# change the database password. Offer the installer's own backup first.
maybe_restore_env_backup() {
  [[ -f "${ROOT_DIR}/.env" ]] && return 0
  [[ "$ARCIIN_MODE" == "fresh" ]] && return 0
  local backup
  backup="$(dirname "$(arciin_journal_path)")/env-backups/latest.env"
  [[ -f "$backup" ]] || return 0
  warn "No .env here, but a backup from a previous Arciin install exists (${backup})."
  local choice="r"
  if [[ -t 0 ]]; then
    echo -e "    ${DIM}[r]${RESET} Restore it  ${DIM}(keeps the same secrets, database password and encryption key — recommended)${RESET}"
    echo -e "    ${DIM}[n]${RESET} Start with a new .env"
    read -r -p "  Restore the previous .env? [R/n]: " choice
    choice="${choice:-r}"
  fi
  if [[ "${choice,,}" == r* ]]; then
    cp "$backup" "${ROOT_DIR}/.env" && chmod 600 "${ROOT_DIR}/.env"
    ok "Restored .env from the previous install"
  fi
}

ensure_env_file() {
  maybe_restore_env_backup
  if [[ ! -f "${ROOT_DIR}/.env" ]]; then
    if [[ ! -f "${ROOT_DIR}/.env.example" ]]; then
      fail ".env.example not found — cannot create .env"
    fi
    cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
    # Fresh install: no encrypted data exists yet, so it is safe to mint a
    # dedicated ARCIIN_ENCRYPTION_KEY. On re-runs of an existing install we
    # leave it alone to avoid orphaning already-encrypted vault/integration data.
    ARCIIN_FRESH_INSTALL=1
    ok "Created .env from .env.example"
  else
    ARCIIN_FRESH_INSTALL=0
    ok ".env already exists"
  fi
}

# An existing .env may come from somewhere else — a Docker install (Compose
# builds DATABASE_URL and REDIS_URL itself, and names services rather than
# localhost) or a run that stopped half-way. Add every key .env.example has
# and .env lacks, never overwriting a value, and point Docker service
# hostnames at this machine. Secrets left as placeholders are generated by the
# steps that follow.
ensure_native_env_keys() {
  local env_file="${ROOT_DIR}/.env" example="${ROOT_DIR}/.env.example" line key added=0
  [[ -f "$env_file" && -f "$example" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)= ]] || continue
    key="${BASH_REMATCH[1]}"
    if ! grep -q "^${key}=" "$env_file" 2>/dev/null; then
      printf '%s\n' "$line" >> "$env_file"
      added=$((added + 1))
    fi
  done < "$example"
  local value
  for key in REDIS_URL ARCIIN_API_URL; do
    value="$({ grep "^${key}=" "$env_file" 2>/dev/null || true; } | tail -1 | cut -d= -f2-)"
    if [[ "$value" =~ //([^/@]*@)?(redis|api|postgres|db|caddy|web)[:/] ]]; then
      _set_env_kv "$env_file" "$key" "$({ grep "^${key}=" "$example" 2>/dev/null || true; } | head -1 | cut -d= -f2-)"
      warn "${key} pointed at a Docker service — set to this machine"
    fi
  done
  [[ "$added" -eq 0 ]] || ok "Added ${added} missing setting(s) to .env from .env.example (existing values kept)"
}

ensure_arciin_storage_path() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "$env_file" ]] || return 0

  local preset="${ARCIIN_DATA_DIR:-}"
  if [[ -z "$preset" ]]; then
    preset="$(grep '^ARCIIN_DATA_DIR=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  fi
  # Empty or legacy in-repo placeholder → prompt (or default) during install.
  if [[ "$preset" == "./data/arciin" ]] || [[ "$preset" == "${ROOT_DIR}/data/arciin" ]]; then
    preset=""
  fi
  # Docker container path — not valid for native PM2 installs.
  if [[ "$preset" == "/data/arciin" ]]; then
    warn "ARCIIN_DATA_DIR=/data/arciin is for Docker only; choosing a host folder instead."
    preset=""
  fi

  # Before creating anything: a path on a disk that is not mounted must not
  # quietly become a folder on the root filesystem.
  local candidate="${preset:-${ARCIIN_DEFAULT_STORAGE:-/srv/arciin-storage/arciin}}"
  if [[ "$(arciin_storage_mount_missing "$candidate")" == "1" && "$ARCIIN_ALLOW_ROOT_STORAGE" != "1" ]]; then
    arciin_fail_report "Storage disk is not mounted (${candidate})" \
      "${candidate} is under $(cut -d/ -f1-3 <<<"$candidate"), but nothing is mounted there — creating it would put your files on the system disk instead." \
      "Nothing was created or deleted." \
      "Mount the disk (check /etc/fstab, then: sudo mount -a) and run ./install.sh again" \
      "Or, if the system disk is intended: ./install.sh --allow-root-storage"
  fi

  local resolved
  resolved="$(_arciin_setup_host_storage "${ROOT_DIR}" "$preset" "${env_file}" 0)" \
    || fail "Could not set up file storage."

  local state
  state="$(arciin_probe_storage_state "$resolved")"
  case "$state" in
    read_only)
      arciin_fail_report "Storage is read-only (${resolved})" \
        "The filesystem refused a test write — the disk may be mounted read-only or failing." \
        "Nothing in ${resolved} was changed." "Check: findmnt -T ${resolved}; remount it read-write, then run ./install.sh again" ;;
    wrong_owner)
      arciin_fail_report "Storage is not writable by $(id -un) (${resolved})" \
        "Arciin runs as $(id -un) and could not create, rename and delete a test file there." \
        "Nothing in ${resolved} was changed." "sudo chown -R $(id -un):$(id -gn) ${resolved}" "Then run ./install.sh again" ;;
    valid_arciin) ok "Existing Arciin files found in ${resolved} — they are kept" ;;
    partial) warn "${resolved} already contains other files — Arciin will add its folders next to them and delete nothing" ;;
  esac

  _set_env_kv "$env_file" "ARCIIN_DATA_DIR" "$resolved"
  arciin_journal_set "dataDir" "$resolved"
  ok "File storage: ${resolved} (write test passed)"
}

ensure_session_secret() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "${env_file}" ]] || return 0
  if grep -q '^SESSION_SECRET=change-this-in-production' "${env_file}" 2>/dev/null; then
    _set_env_kv "$env_file" "SESSION_SECRET" "$(_gen_secret)"
    ok "Generated SESSION_SECRET"
  fi
}

ensure_setup_token() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "${env_file}" ]] || return 0
  if grep -q '^ARCIIN_SETUP_TOKEN=dev-token' "${env_file}" 2>/dev/null; then
    _set_env_kv "$env_file" "ARCIIN_SETUP_TOKEN" "$(openssl rand -hex 24 2>/dev/null || _gen_secret)"
    ok "Generated ARCIIN_SETUP_TOKEN"
  fi
}

start_service() {
  local service_name="$1"
  # has_systemd(), not `command -v systemctl` — on WSL the binary exists while
  # systemd is off, and every systemctl call then fails.
  if has_systemd; then
    sudo systemctl enable --now "$service_name" &>/dev/null || warn "Could not enable/start ${service_name}"
  else
    sudo service "$service_name" start &>/dev/null || warn "Could not start ${service_name}"
  fi
}

# Instance claim state in the local PostgreSQL `arciin` database.
# Prints one of: missing | empty | claimed | partial | unknown
# - missing: no database yet
# - empty: database exists but no owner users (first-run setup is correct)
# - claimed: at least one User row (login, not setup)
# - partial: InstanceConfig without users (broken; treat as needs setup after cleanup)
detect_arciin_db_claim_state() {
  local pg_port="${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}"
  if ! command -v psql >/dev/null 2>&1; then
    echo "unknown"
    return 0
  fi

  if ! sudo -u postgres env PGPORT="$pg_port" psql -tAc "SELECT 1 FROM pg_database WHERE datname='arciin'" 2>/dev/null | grep -q 1; then
    echo "missing"
    return 0
  fi

  local has_user_table has_instance_table user_count instance_count
  has_user_table="$(sudo -u postgres env PGPORT="$pg_port" psql -d arciin -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='User'" 2>/dev/null | tr -d '[:space:]' || true)"
  has_instance_table="$(sudo -u postgres env PGPORT="$pg_port" psql -d arciin -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='InstanceConfig'" 2>/dev/null | tr -d '[:space:]' || true)"

  if [[ "$has_user_table" != "1" && "$has_instance_table" != "1" ]]; then
    echo "empty"
    return 0
  fi

  user_count=0
  instance_count=0
  if [[ "$has_user_table" == "1" ]]; then
    user_count="$(sudo -u postgres env PGPORT="$pg_port" psql -d arciin -tAc 'SELECT COUNT(*)::text FROM "User"' 2>/dev/null | tr -d '[:space:]' || echo 0)"
  fi
  if [[ "$has_instance_table" == "1" ]]; then
    instance_count="$(sudo -u postgres env PGPORT="$pg_port" psql -d arciin -tAc 'SELECT COUNT(*)::text FROM "InstanceConfig"' 2>/dev/null | tr -d '[:space:]' || echo 0)"
  fi
  user_count="${user_count:-0}"
  instance_count="${instance_count:-0}"

  if [[ "$user_count" =~ ^[1-9][0-9]*$ ]]; then
    echo "claimed"
  elif [[ "$instance_count" =~ ^[1-9][0-9]*$ ]]; then
    echo "partial"
  else
    echo "empty"
  fi
}

drop_arciin_database() {
  local pg_port="${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}"
  spin_ok "Dropping existing arciin database..." "Database dropped" \
    bash -c "sudo -u postgres env PGPORT='${pg_port}' psql -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='arciin' AND pid <> pg_backend_pid();\" >/dev/null 2>&1 || true; \
      sudo -u postgres env PGPORT='${pg_port}' psql -c \"DROP DATABASE IF EXISTS arciin;\" && \
      sudo -u postgres env PGPORT='${pg_port}' psql -c \"DROP ROLE IF EXISTS arciin;\"" || true
}

# What is already in PostgreSQL decides what this run does — never a guess,
# and never a default that destroys data.
#
#   missing / empty   → install
#   valid / partial   → repair (keep everything) unless --fresh is confirmed
#   foreign           → stop: an unrelated database is named arciin
ARCIIN_DB_STATE="unknown"
maybe_handle_existing_arciin_db() {
  local pg_port="${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}" facts state claim
  facts="$(arciin_probe_db_facts_native "$pg_port")"
  # exists tables has_migrations has_instance has_user failed users instances
  read -r f_exists f_tables f_mig f_inst f_user f_failed f_users f_instances <<<"$facts"
  state="$(arciin_classify_db "$f_exists" "$f_tables" "$f_mig" "$f_inst" "$f_user" "$f_failed")"
  claim="$(arciin_classify_db_claim "$f_users" "$f_instances")"
  ARCIIN_DB_STATE="$state"
  ARCIIN_DB_CLAIM_STATE="$claim"
  arciin_journal_set "dbState" "$state"

  case "$state" in
    missing) ok "No Arciin database yet — it will be created"; [[ "$ARCIIN_MODE" == "fresh" ]] && RESET_DB=false; return 0 ;;
    empty)   ok "PostgreSQL database 'arciin' is empty — first-run setup will be available"; return 0 ;;
  esac

  echo ""
  case "$state" in
    valid_arciin)
      warn "Existing Arciin installation detected"
      echo -e "    ${DIM}Database${RESET}   arciin  ${DIM}(${f_tables} tables, ${f_users} user(s), instance ${claim})${RESET}" ;;
    partial_arciin)
      warn "Partial Arciin database detected"
      echo -e "    ${DIM}Database${RESET}   arciin  ${DIM}(${f_tables} tables; a previous install or migration did not finish)${RESET}" ;;
    foreign)
      warn "A database named 'arciin' exists, but it is not an Arciin database"
      echo -e "    ${DIM}Database${RESET}   arciin  ${DIM}(${f_tables} tables, no Arciin schema)${RESET}" ;;
  esac
  echo ""

  # Explicit --fresh: show the plan, require the typed phrase.
  if [[ "$ARCIIN_MODE" == "fresh" ]]; then
    native_confirm_fresh "$state" || arciin_fail_report "Fresh install cancelled" \
      "The confirmation phrase was not entered." "Nothing was deleted." "Run ./install.sh --repair to keep your data" "Or ./install.sh --fresh and type ERASE ARCIIN"
    drop_arciin_database
    RESET_DB=false
    ARCIIN_DB_STATE="missing"; ARCIIN_DB_CLAIM_STATE="unclaimed"
    ok "Arciin database erased — continuing as a fresh install"
    return 0
  fi

  if [[ "$state" == "foreign" ]]; then
    arciin_fail_report "An unrelated database is already named 'arciin'" \
      "It has ${f_tables} tables but no Arciin schema, so Arciin will neither migrate into it nor erase it." \
      "That database has NOT been touched." \
      "Rename or remove it yourself (e.g. sudo -u postgres psql -c 'ALTER DATABASE arciin RENAME TO arciin_old')" \
      "Or, to erase it and install Arciin: ./install.sh --fresh"
  fi

  # valid / partial: repair is the default; Enter keeps everything.
  local choice="1"
  local policy="${ARCIIN_ON_EXISTING_DB:-}"; policy="${policy,,}"
  if [[ "$policy" == "wipe" || "$policy" == "fresh" || "$policy" == "reset" ]]; then
    choice="2"
  elif [[ "$ARCIIN_MODE" != "repair" && -t 0 ]]; then
    echo -e "  ${BOLD}What would you like to do?${RESET}"
    echo -e "    ${BOLD}1)${RESET} Repair / keep existing data  ${DIM}[default]${RESET}"
    echo -e "    ${BOLD}2)${RESET} Fresh install — erase the Arciin database"
    echo -e "    ${BOLD}3)${RESET} Cancel"
    read -r -p "  Choice [1]: " choice
    choice="${choice:-1}"
  fi
  case "$choice" in
    2)
      native_confirm_fresh "$state" || arciin_fail_report "Fresh install cancelled" \
        "The confirmation phrase was not entered." "Nothing was deleted." "Run ./install.sh again to repair"
      drop_arciin_database
      ARCIIN_MODE="fresh"; RESET_DB=false
      ARCIIN_DB_STATE="missing"; ARCIIN_DB_CLAIM_STATE="unclaimed"
      ok "Arciin database erased — continuing as a fresh install" ;;
    3) echo ""; warn "Cancelled — nothing was changed."; exit 0 ;;
    *)
      ARCIIN_MODE="repair"
      ok "Repairing — the database, files, instance ID, license and settings are kept"
      native_pre_repair_backup ;;
  esac
  echo ""
}

# Shows exactly what --fresh removes and asks for the typed phrase.
native_confirm_fresh() {
  local state="$1" storage
  storage="$(grep '^ARCIIN_DATA_DIR=' "${ROOT_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  echo -e "  ${BOLD}${RED}Fresh install will remove:${RESET}"
  echo -e "    Database              arciin ${DIM}(${state}; users, libraries, file records, license activation, settings)${RESET}"
  echo -e "    Database role         arciin"
  echo -e "    Storage folder        ${GREEN}NOT deleted${RESET} ${DIM}(${storage:-default}); files stay on disk${RESET}"
  echo -e "    ${DIM}A new instance ID is created, so a paid license must be activated again${RESET}"
  echo -e "    ${DIM}(release the old server at https://arciin.com/account if it uses your seat).${RESET}"
  echo ""
  arciin_confirm_typed "ERASE ARCIIN"
}

# Before a repair touches the schema or processes: a logical database dump and
# a copy of .env. Files are not copied — a repair never modifies them.
native_pre_repair_backup() {
  local pg_port="${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}" storage dir ts
  storage="$(grep '^ARCIIN_DATA_DIR=' "${ROOT_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dir="${storage:-${ROOT_DIR}/data/arciin}/backups/repair-${ts}"
  mkdir -p "$dir" 2>/dev/null || dir="$(dirname "$(arciin_journal_path)")/backups/repair-${ts}"
  mkdir -p "$dir" && chmod 700 "$dir"
  if sudo -u postgres env PGPORT="$pg_port" pg_dump -Fc arciin >"${dir}/database.dump" 2>/dev/null && [[ -s "${dir}/database.dump" ]]; then
    ok "Database backed up before repair: ${dir}/database.dump"
  else
    rm -f "${dir}/database.dump"
    arciin_fail_report "Could not back up the database before repairing" \
      "pg_dump of 'arciin' failed, and repair does not modify a database it could not back up." \
      "Nothing was changed." "Check that PostgreSQL is running: sudo systemctl status postgresql" "Then run ./install.sh --repair again"
  fi
  [[ -f "${ROOT_DIR}/.env" ]] && cp "${ROOT_DIR}/.env" "${dir}/env.backup" && chmod 600 "${dir}/env.backup"
  arciin_journal_set "lastRepairBackup" "$dir"
}

ensure_postgres_role_and_db() {
  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found — skipping PostgreSQL role/database setup"
    return 0
  fi

  local pg_port="${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}"
  export PGPORT="$pg_port"

  if $RESET_DB; then
    drop_arciin_database
  fi

  local password="${ARCIIN_DB_PASSWORD:-}"
  if [[ -z "$password" ]]; then
    arciin_resolve_db_password_into password "${ROOT_DIR}/.env" "${ARCIIN_FRESH_INSTALL:-0}" \
      "$(dirname "$(arciin_journal_path)")/env-backups/latest.env" \
      || fail "Could not resolve a database password for the arciin role."
  fi

  local role_exists=0
  if sudo -u postgres env PGPORT="$pg_port" psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='arciin'" | grep -q 1; then
    role_exists=1
  fi

  if [[ "$role_exists" -eq 0 ]]; then
    # On stdin, not -c: psql substitutes :'pwd' only in script input. With -c
    # the literal :'pwd' reached the server as a syntax error, so a native
    # install on a brand-new server could never create its role.
    printf '%s\n' "CREATE ROLE arciin WITH LOGIN PASSWORD :'pwd' CREATEDB;" \
      | sudo -u postgres env PGPORT="$pg_port" psql -X -q -v ON_ERROR_STOP=1 -v pwd="$password" &>/dev/null
  else
    # The role already exists. .env is the source of truth for its password:
    # if a real login with the .env credentials fails, set the role's password
    # to match. This touches no data and rotates no secret — it repairs drift
    # (a restored .env, a re-cloned folder, an earlier half-finished install).
    local db_url auth
    db_url="$({ grep '^DATABASE_URL=' "${ROOT_DIR}/.env" 2>/dev/null || true; } | cut -d= -f2- | tr -d '"')"
    auth="$(arciin_probe_db_auth "$db_url" 2>/dev/null || true)"
    if [[ "$auth" != "ok" ]]; then
      printf '%s\n' "ALTER ROLE arciin WITH LOGIN PASSWORD :'pwd' CREATEDB;" \
        | sudo -u postgres env PGPORT="$pg_port" psql -X -q -v ON_ERROR_STOP=1 -v pwd="$password" &>/dev/null
      [[ "$auth" == "auth_failed" ]] && ok "Database role password realigned with .env (no data changed)"
    fi
  fi

  if sudo -u postgres env PGPORT="$pg_port" psql -tAc "SELECT 1 FROM pg_database WHERE datname='arciin'" | grep -q 1; then
    sudo -u postgres env PGPORT="$pg_port" psql -c "ALTER DATABASE arciin OWNER TO arciin;" &>/dev/null
  else
    sudo -u postgres env PGPORT="$pg_port" psql -c "CREATE DATABASE arciin OWNER arciin;" &>/dev/null
  fi

  sudo -u postgres env PGPORT="$pg_port" psql -d arciin -c "GRANT ALL ON SCHEMA public TO arciin;" &>/dev/null || true

  # Proof, not a guess: log in with exactly what the app will use.
  local final_url final_auth
  final_url="$({ grep '^DATABASE_URL=' "${ROOT_DIR}/.env" 2>/dev/null || true; } | cut -d= -f2- | tr -d '"')"
  final_auth="$(arciin_probe_db_auth "$final_url" 2>/dev/null || true)"
  if [[ "$final_auth" != "ok" ]]; then
    arciin_fail_report "Arciin cannot log in to PostgreSQL (${final_auth})" \
      "PostgreSQL is running, but a login with the credentials in .env failed." \
      "Your data has NOT been deleted." \
      "Run: bash scripts/arciin-doctor.sh" "Then: ./install.sh --repair"
  fi
  arciin_journal_step "database"
  ok "PostgreSQL role/database ready (port ${pg_port}) — authenticated login verified"
}

# ── Preconditions ─────────────────────────────────────────────────────────────
if [[ "${EUID}" -eq 0 ]]; then
  fail "Run this script as your normal user, not as root."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  # Windows users land here from Git Bash / MSYS, where apt does not exist.
  # Point them at WSL rather than leaving them to guess.
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*)
      echo ""
      echo -e "  ${YELLOW}This looks like Git Bash or MSYS on Windows.${RESET}"
      echo -e "  Arciin installs through ${BOLD}WSL2${RESET}, not Git Bash. In PowerShell (as Administrator):"
      echo ""
      echo -e "      ${BOLD}wsl --install -d Ubuntu${RESET}"
      echo ""
      echo -e "  Then open ${BOLD}Ubuntu${RESET} from the Start menu, clone the repo into your Linux"
      echo -e "  home (${DIM}not /mnt/c${RESET}), and run this script there."
      echo -e "  ${DIM}Full steps: README.md → \"Windows (WSL2)\"${RESET}"
      echo ""
      fail "Run install.sh inside WSL2, not Git Bash."
      ;;
  esac
  fail "This installer supports Debian/Ubuntu/WSL with apt. Use Docker or manual setup on other OSes."
fi

command -v sudo >/dev/null 2>&1 || fail "sudo is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

# ── Install mode (Docker vs native) ───────────────────────────────────────────
if [[ -t 0 ]] && [[ "${ARCIIN_SKIP_INSTALL_CHOICE:-0}" != "1" ]] && [[ "${ARCIIN_INSTALL_MODE:-}" != "native" ]]; then
  echo ""
  echo -e "  ${BOLD}${WHITE}How do you want to run Arciin?${RESET}"
  echo -e "  ${DIM}Host:${RESET} $(host_display_name)"
  echo ""
  echo -e "    ${BOLD}1)${RESET} Docker ${DIM}(recommended — Postgres/Redis/Node in containers)${RESET}"
  echo -e "    ${BOLD}2)${RESET} Native ${DIM}(PM2 on this machine — needs apt packages)${RESET}"
  echo ""
  read -r -p "  Choice [1]: " _install_choice
  _install_choice="${_install_choice:-1}"
  if [[ "$_install_choice" == "1" ]]; then
    if docker_available; then
      exec "${ROOT_DIR}/scripts/docker-setup.sh"
    fi
    warn "Docker is not installed yet."
    echo -e "    ${DIM}curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker \$USER${RESET}"
    echo -e "    ${DIM}Log out/in, then: ./scripts/docker-setup.sh${RESET}"
    fail "Install Docker first, or choose native (2)."
  fi
  ARCIIN_INSTALL_MODE=native
fi

require_sudo_credentials

# ── Preflight: machine resources ──────────────────────────────────────────────
# A native install builds the web app on this machine. Next.js needs memory to
# do that; when it runs out, the kernel kills the build and the install stops
# with a message nobody can act on. Say so up front instead.
preflight_resources() {
  local arch mem_kb swap_kb mem_mb swap_mb free_kb free_gb
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64|aarch64|arm64) ok "Architecture: ${arch}" ;;
    *) arciin_fail_report "Unsupported CPU architecture (${arch})" \
         "Arciin's native install supports x86_64 and arm64." \
         "Nothing was changed." "Use a 64-bit x86 or ARM server." ;;
  esac
  free_kb="$(df -Pk "${ROOT_DIR}" | awk 'NR==2 {print $4}')"
  free_gb=$(( ${free_kb:-0} / 1024 / 1024 ))
  if (( free_gb < 6 )); then
    arciin_fail_report "Not enough free disk space (${free_gb} GB free)" \
      "A native install needs about 6 GB for dependencies and the build, plus room for your files." \
      "Nothing was changed." "Free some space on $(df -P "${ROOT_DIR}" | awk 'NR==2 {print $6}') and run ./install.sh again."
  fi
  ok "Disk: ${free_gb} GB free"
  mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal/ {print $2}' /proc/meminfo)"
  mem_mb=$(( ${mem_kb:-0} / 1024 )); swap_mb=$(( ${swap_kb:-0} / 1024 ))
  if (( mem_mb + swap_mb < 3500 )); then
    warn "Memory: ${mem_mb} MB RAM + ${swap_mb} MB swap — building the web app needs about 3.5 GB."
    echo -e "    ${DIM}The build is likely to be killed for lack of memory. Options:${RESET}"
    echo -e "    ${DIM}  • Docker uses prebuilt images and needs no build:${RESET} ${BOLD}./install.sh --docker${RESET}"
    echo -e "    ${DIM}  • Add swap yourself (e.g. 4 GB), then run ./install.sh again${RESET}"
    if [[ -t 0 ]] && [[ "${ARCIIN_ALLOW_LOW_MEMORY:-0}" != "1" ]]; then
      read -r -p "  Continue the native install anyway? [y/N]: " _lowmem
      [[ "${_lowmem,,}" == y || "${_lowmem,,}" == yes ]] || \
        arciin_fail_report "Install stopped before building (low memory)" \
          "Building Arciin needs more memory than this machine has." \
          "Nothing was changed." "Run ./install.sh --docker" "Or add swap and run ./install.sh again"
    elif [[ "${ARCIIN_ALLOW_LOW_MEMORY:-0}" != "1" ]]; then
      arciin_fail_report "Install stopped before building (low memory)" \
        "Building Arciin needs about 3.5 GB of RAM + swap; this machine has $(( mem_mb + swap_mb )) MB." \
        "Nothing was changed." "Run ./install.sh --docker" "Or set ARCIIN_ALLOW_LOW_MEMORY=1 to try anyway"
    fi
  else
    ok "Memory: ${mem_mb} MB RAM + ${swap_mb} MB swap"
  fi
}

# ── Uninstall ─────────────────────────────────────────────────────────────────
# Removing the application and deleting data are different actions. Plain
# --uninstall stops and removes Arciin's PM2 processes and keeps everything
# else; --delete-data (typed confirmation) drops the database and .env;
# --delete-storage (a second typed confirmation) deletes files.
native_backup_env() {
  local env_file="${ROOT_DIR}/.env" dir
  [[ -f "$env_file" ]] || return 0
  dir="$(dirname "$(arciin_journal_path)")/env-backups"
  mkdir -p "$dir" && chmod 700 "$dir"
  cp "$env_file" "${dir}/env-$(date -u +%Y%m%dT%H%M%SZ)" && cp "$env_file" "${dir}/latest.env"
  chmod 600 "${dir}"/* 2>/dev/null || true
  echo "${dir}/latest.env"
}

native_uninstall() {
  step "Uninstall"
  local backup storage
  storage="$(grep '^ARCIIN_DATA_DIR=' "${ROOT_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  backup="$(native_backup_env)"
  [[ -n "$backup" ]] && ok ".env backed up to ${backup}"
  if command -v pm2 >/dev/null 2>&1; then
    local name
    for name in arciin-web arciin-api arciin-worker; do
      pm2 delete "$name" >/dev/null 2>&1 && ok "Removed PM2 process ${name}" || true
    done
    pm2 save >/dev/null 2>&1 || true
  fi
  arciin_journal_set "installed" "no"
  arciin_journal_set "uninstalledAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ "$ARCIIN_DELETE_DATA" != "1" ]]; then
    echo ""
    ok "Arciin's services are removed. Kept: database 'arciin', files in ${storage:-the storage folder}, .env and its backup."
    echo -e "    ${DIM}Reinstall later with ./install.sh — it will find and keep this data.${RESET}"
    echo -e "    ${DIM}To delete the data too: ./install.sh --uninstall --delete-data${RESET}"
    exit 0
  fi

  echo ""
  echo -e "  ${BOLD}${RED}--delete-data will permanently remove:${RESET}"
  echo -e "    PostgreSQL database   arciin (and its role)"
  echo -e "    Configuration         ${ROOT_DIR}/.env  ${DIM}(a backup stays at ${backup:-—})${RESET}"
  if [[ "$ARCIIN_DELETE_STORAGE" == "1" ]]; then
    echo -e "    Storage folder        ${storage:-—}  ${DIM}(confirmed separately)${RESET}"
  else
    echo -e "    Storage folder        ${GREEN}NOT deleted${RESET} ${DIM}(${storage:-—}; add --delete-storage to delete it)${RESET}"
  fi
  echo ""
  arciin_confirm_typed "ERASE ARCIIN" || { warn "Cancelled — nothing was deleted."; exit 1; }
  drop_arciin_database
  rm -f "${ROOT_DIR}/.env"
  ok "Database and .env removed"
  if [[ "$ARCIIN_DELETE_STORAGE" == "1" && -n "$storage" && -d "$storage" ]]; then
    echo -e "  ${BOLD}${RED}Delete every file in ${storage}?${RESET}"
    if arciin_confirm_typed "DELETE FILES"; then
      rm -rf -- "$storage" && ok "Storage folder deleted"
    else
      warn "Storage folder kept."
    fi
  fi
  exit 0
}

if [[ "$ARCIIN_MODE" == "uninstall" ]]; then
  native_uninstall
fi

step "Preflight"
preflight_resources
arciin_journal_set "mode" "native"
arciin_journal_set "installDir" "${ROOT_DIR}"
arciin_journal_set "version" "$(node -p "require('${ROOT_DIR}/package.json').version" 2>/dev/null || grep -m1 '"version"' "${ROOT_DIR}/package.json" | cut -d'"' -f4)"
arciin_journal_set "releaseSha" "$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || echo unknown)"

# ── 1. System packages ────────────────────────────────────────────────────────
step "System packages"

_apt_install_system_deps() {
  local log held
  log="$(mktemp)"
  if sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -qq \
    ca-certificates curl git gnupg build-essential unzip python3 openssl \
    libssl-dev pkg-config libatomic1 lsof \
    ffmpeg poppler-utils redis-server postgresql postgresql-contrib >"$log" 2>&1; then
    rm -f "$log"
    return 0
  fi
  held=0
  if grep -qiE 'held broken|broken packages|unmet dependencies' "$log" 2>/dev/null; then
    held=1
  fi
  echo ""
  sed 's/^/    /' "$log"
  rm -f "$log"
  echo ""
  if [[ "$held" == "1" ]]; then
    warn "apt reported held or broken packages on this host."
  else
    warn "apt could not install required packages."
  fi
  echo -e "    ${DIM}Fix apt:${RESET}  sudo apt --fix-broken install && sudo dpkg --configure -a"
  echo -e "    ${DIM}Or Docker:${RESET} ./install.sh --docker  ${DIM}(see docs/DOCKER.md)${RESET}"
  print_docker_hint
  fail "System package installation failed"
}

# yt-dlp + gallery-dl power the URL-import feature (videos, social, galleries).
# apt versions lag badly, so install the official standalone binaries. Both are
# self-contained and use the system python3 (installed above). Non-fatal: import
# is a feature, not a core requirement.
install_media_import_tools() {
  local bindir="/usr/local/bin"

  if command -v yt-dlp >/dev/null 2>&1; then
    ok "yt-dlp $(yt-dlp --version 2>/dev/null | head -1) already installed"
  else
    if sudo curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o "${bindir}/yt-dlp" 2>/dev/null \
      && sudo chmod a+rx "${bindir}/yt-dlp" 2>/dev/null \
      && "${bindir}/yt-dlp" --version >/dev/null 2>&1; then
      ok "yt-dlp installed (video/social link imports)"
    else
      sudo rm -f "${bindir}/yt-dlp" 2>/dev/null || true
      warn "yt-dlp not installed — importing videos from links won't work until you install it"
    fi
  fi

  if command -v gallery-dl >/dev/null 2>&1; then
    ok "gallery-dl already installed"
  else
    if sudo curl -fsSL "https://github.com/mikf/gallery-dl/releases/latest/download/gallery-dl.bin" -o "${bindir}/gallery-dl" 2>/dev/null \
      && sudo chmod a+rx "${bindir}/gallery-dl" 2>/dev/null \
      && "${bindir}/gallery-dl" --version >/dev/null 2>&1; then
      ok "gallery-dl installed (image gallery imports)"
    else
      sudo rm -f "${bindir}/gallery-dl" 2>/dev/null || true
      warn "gallery-dl not installed — importing from image galleries won't work until you install it"
    fi
  fi
}

if [[ "${ARCIIN_SKIP_SYSTEM_PACKAGES:-0}" == "1" ]]; then
  ok "Skipping system packages (ARCIIN_SKIP_SYSTEM_PACKAGES=1)"
else
  spin_ok "Updating package lists..." "Package lists updated" sudo apt-get update -qq

  # Installing Arciin does not upgrade the whole system. That took minutes,
  # could pull a new kernel, and could stop on needrestart's prompt.
  if [[ "${ARCIIN_UPGRADE_SYSTEM:-0}" == "1" ]]; then
    spin_ok "Upgrading installed packages..." "System packages upgraded" \
      sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get upgrade -y -qq \
        -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold
  else
    ok "Only Arciin's dependencies are installed (ARCIIN_UPGRADE_SYSTEM=1 also upgrades the system)"
  fi

  doing "Installing dependencies (curl, git, ffmpeg, poppler, PostgreSQL, Redis)..."
  if _apt_install_system_deps; then
    done_ "curl, git, ffmpeg, poppler-utils, lsof, PostgreSQL, Redis ready"
  fi

  install_media_import_tools

  if command -v cloudflared >/dev/null 2>&1; then
    ok "cloudflared $(cloudflared --version 2>/dev/null | head -1 || true)"
  elif [[ -x "${ROOT_DIR}/scripts/install-cloudflared.sh" ]]; then
    if bash "${ROOT_DIR}/scripts/install-cloudflared.sh" >/dev/null 2>&1 \
      || sudo bash "${ROOT_DIR}/scripts/install-cloudflared.sh" >/dev/null 2>&1; then
      ok "cloudflared installed (quick public URL / tunnel)"
    else
      warn "cloudflared not installed — Settings → Domain quick tunnel will not work until you install it"
    fi
  fi
fi

# ── 2. Node.js ────────────────────────────────────────────────────────────────
step "Node.js"

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "${NODE_MAJOR}" -ge "${DEFAULT_NODE_MAJOR}" ]]; then
    ok "Node.js $(node -v) already installed"
  else
    _node_label="Upgrading Node.js to ${DEFAULT_NODE_MAJOR}..."
    if spin "$_node_label" install_nodejs_nodesource "${DEFAULT_NODE_MAJOR}"; then
      done_ "Node.js $(node -v) ready"
    else
      report_spin_failure "$_node_label"
    fi
  fi
else
  _node_label="Installing Node.js ${DEFAULT_NODE_MAJOR}..."
  if spin "$_node_label" install_nodejs_nodesource "${DEFAULT_NODE_MAJOR}"; then
    done_ "Node.js $(node -v) installed"
  else
    report_spin_failure "$_node_label"
  fi
fi

# ── 3. pnpm ───────────────────────────────────────────────────────────────────
step "pnpm"

if command -v pnpm >/dev/null 2>&1 && [[ "$(pnpm --version 2>/dev/null)" == "${DEFAULT_PNPM_VERSION}" ]]; then
  ok "pnpm ${DEFAULT_PNPM_VERSION} already active"
else
  spin_ok "Updating Corepack..." "Corepack ready" sudo npm install --global corepack@latest --silent
  corepack enable pnpm
  spin_ok "Activating pnpm ${DEFAULT_PNPM_VERSION}..." "pnpm $(pnpm --version) ready" \
    corepack prepare "pnpm@${DEFAULT_PNPM_VERSION}" --activate
fi

# ── 4. Environment ────────────────────────────────────────────────────────────
step "Environment"

ensure_env_file
ensure_native_env_keys
ensure_arciin_storage_path
ensure_session_secret
ensure_setup_token
ensure_production_secrets
_env_backup_path="$(native_backup_env)"
[[ -n "$_env_backup_path" ]] && ok ".env backed up (${_env_backup_path}) — used to recover if .env is ever lost"
arciin_journal_step "environment"
stop_existing_arciin
configure_app_ports

# ── 5. Services ───────────────────────────────────────────────────────────────
step "Redis & PostgreSQL"

start_service redis-server
start_service postgresql

if redis-cli ping &>/dev/null 2>&1; then
  ok "Redis on localhost:6379"
else
  warn "Redis is not responding on localhost:6379"
fi

configure_postgres_port
# Detect leftover Postgres claim BEFORE creating role/DB (and optionally wipe).
maybe_handle_existing_arciin_db
ensure_postgres_role_and_db

# ── 6. Dependencies ───────────────────────────────────────────────────────────
step "JavaScript dependencies"

cd "${ROOT_DIR}"
spin_ok "Installing workspace packages..." "Packages installed" \
  bash -c 'pnpm install --silent 2>/dev/null || pnpm install'

spin_ok "Approving dependency build scripts..." "Build scripts approved" \
  bash -c 'pnpm approve-builds --all 2>/dev/null || true'

# ── 7. Database ───────────────────────────────────────────────────────────────
step "Database"

spin_ok "Generating Prisma client..." "Prisma client ready" pnpm db:generate

if [[ "${ARCIIN_SKIP_DB_INIT:-0}" == "1" ]]; then
  warn "Skipping migrations/seed (ARCIIN_SKIP_DB_INIT=1)"
else
  spin_ok "Applying migrations and seed..." "Database ready" \
    bash "${ROOT_DIR}/scripts/arciin-init.sh"
  arciin_journal_step "migrations"
fi

# Re-check after migrations/seed so the summary matches reality.
ARCIIN_DB_CLAIM_STATE="$(detect_arciin_db_claim_state)"
case "$ARCIIN_DB_CLAIM_STATE" in
  claimed)
    ok "Instance state: claimed (owner account exists → use /login)"
    ;;
  partial)
    warn "Instance state: partial (config without users → use /setup to claim)"
    ;;
  empty|missing)
    ok "Instance state: unclaimed (first-run → use /setup)"
    ;;
  *)
    warn "Instance state: could not detect (check API /instance/status after start)"
    ;;
esac

chmod +x "${ROOT_DIR}/scripts/arciin-init.sh" "${ROOT_DIR}/scripts/entrypoint-api.sh" 2>/dev/null || true

# ── 8. Health checks ──────────────────────────────────────────────────────────
step "Health checks"

if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg available"
else
  warn "ffmpeg missing — thumbnails and media probes will not work"
fi

# ── 9. Firewall ──────────────────────────────────────────────────────────────
step "Firewall"

if [[ "${ARCIIN_SKIP_FIREWALL:-0}" == "1" ]]; then
  warn "Skipping UFW (ARCIIN_SKIP_FIREWALL=1)"
else
  configure_firewall
fi

# ── 10. LAN discovery (Avahi, fail-safe) ─────────────────────────────────────
step "LAN discovery"
arciin_setup_persistent_mdns "${ARCIIN_WEB_PORT}"

chmod +x "${ROOT_DIR}/start.sh" "${ROOT_DIR}/stop.sh" \
  "${ROOT_DIR}/scripts/start.sh" "${ROOT_DIR}/scripts/stop.sh" \
  "${ROOT_DIR}/scripts/port-status.sh" \
  "${ROOT_DIR}/scripts/run-api-prod.sh" \
  "${ROOT_DIR}/scripts/run-worker-prod.sh" 2>/dev/null || true

# ── 11. Production launch (PM2) ─────────────────────────────────────────────
step "Production launch"

if [[ "${ARCIIN_SKIP_PM2:-0}" == "1" ]]; then
  warn "Skipping PM2 launch (ARCIIN_SKIP_PM2=1) — run: pnpm build:web && pm2 start ecosystem.config.cjs"
else
  launch_pm2
fi

# ── 12. Summary ───────────────────────────────────────────────────────────────
step "Ready"

echo -e "  ${BOLD}License service${RESET} ${DIM}(connectivity only — no key needed to install)${RESET}"
( set -a; . "${ROOT_DIR}/.env" 2>/dev/null; set +a; node "${ROOT_DIR}/scripts/license-preflight.mjs" ) \
  || warn "License service not reachable from this server — Arciin works on the free plan; paid activation will fail until this is fixed (bash scripts/arciin-doctor.sh)"
arciin_journal_set "installed" "yes"
arciin_journal_set "installedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
arciin_journal_set "webPort" "${ARCIIN_WEB_PORT:-}"
arciin_journal_set "apiPort" "${ARCIIN_API_PORT:-}"
arciin_journal_step "complete"

ENV_FILE="${ROOT_DIR}/.env"
SETUP_TOKEN="$(grep '^ARCIIN_SETUP_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo 'dev-token')"
PUBLIC_URL="$(grep '^ARCIIN_PUBLIC_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "http://localhost:${DEFAULT_WEB_PORT}")"
LOCAL_URL="http://localhost:$(_env_public_url_port "$ENV_FILE" 2>/dev/null || echo "${DEFAULT_WEB_PORT}")"
API_URL="$(grep '^ARCIIN_API_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "http://127.0.0.1:${DEFAULT_API_PORT}")"
WEB_PORT="$(_env_public_url_port "$ENV_FILE" 2>/dev/null || echo "${DEFAULT_WEB_PORT}")"
API_PORT="$(grep '^API_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "${DEFAULT_API_PORT}")"
PG_PORT="$(grep '^ARCIIN_PG_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}")"
SETUP_URL="${PUBLIC_URL}/setup?token=${SETUP_TOKEN}"
LOGIN_URL="${PUBLIC_URL}/login"
LAN_IP="$(_detect_lan_ip)"
# Prefer post-migration detection; fall back if detect was unavailable earlier.
ARCIIN_DB_CLAIM_STATE="${ARCIIN_DB_CLAIM_STATE:-$(detect_arciin_db_claim_state)}"

echo ""
echo ""
echo -e "  ${BGREEN}╔════════════════════════════════════════════════════════╗${RESET}"
echo -e "  ${BGREEN}║   ✔  Installation complete!                            ║${RESET}"
echo -e "  ${BGREEN}╚════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}${WHITE}Services & ports${RESET}"
echo ""
echo -e "    ${DIM}Web UI (LAN)${RESET}   ${BOLD}${WHITE}${PUBLIC_URL}${RESET}  ${DIM}(port ${WEB_PORT}, 0.0.0.0)${RESET}"
echo -e "    ${DIM}Web UI (local)${RESET} ${BOLD}${WHITE}${LOCAL_URL}${RESET}"
echo -e "    ${DIM}API (LAN)${RESET}      ${BOLD}${WHITE}http://${LAN_IP}:${API_PORT}${RESET}  ${DIM}(port ${API_PORT}, 0.0.0.0)${RESET}"
echo -e "    ${DIM}API (local)${RESET}    ${BOLD}${WHITE}${API_URL}${RESET}"
echo -e "    ${DIM}PostgreSQL${RESET}   localhost:${PG_PORT}"
echo -e "    ${DIM}Redis${RESET}        localhost:6379"
echo ""
echo -e "  ${BOLD}${WHITE}Get started${RESET}"
echo ""
if [[ "${ARCIIN_BOOT_PERSISTENT:-0}" == "1" ]]; then
  echo -e "    ${BGREEN}1.${RESET}  Arciin is running under ${BOLD}PM2${RESET} (production, auto-restart on boot)"
elif is_wsl; then
  echo -e "    ${BGREEN}1.${RESET}  Arciin is running under ${BOLD}PM2${RESET} ${DIM}(restart after each Windows reboot:${RESET} ${BOLD}bash start.sh${DIM})${RESET}"
else
  echo -e "    ${BGREEN}1.${RESET}  Arciin is running under ${BOLD}PM2${RESET} ${DIM}(no systemd — start manually after reboot:${RESET} ${BOLD}bash start.sh${DIM})${RESET}"
fi

if [[ "$ARCIIN_DB_CLAIM_STATE" == "claimed" ]]; then
  echo -e "    ${BGREEN}2.${RESET}  This instance is ${BOLD}already claimed${RESET} (owner account exists in PostgreSQL)."
  echo -e "    ${BGREEN}3.${RESET}  Open sign-in:  ${BOLD}${LOGIN_URL}${RESET}"
  echo -e "    ${DIM}   Use the owner email/password created when this database was first claimed.${RESET}"
  echo -e "    ${DIM}   Need a true first-run again? ${BOLD}./install.sh --fresh${RESET} ${DIM}(typed confirmation; files are kept)${RESET}"
  echo ""
  echo -e "  ${BOLD}${WHITE}Why not /setup?${RESET}"
  echo -e "    ${DIM}Setup is only for unclaimed databases. Re-installing code does not erase Postgres.${RESET}"
  echo ""
else
  echo -e "    ${BGREEN}2.${RESET}  Open first-run setup:  ${BOLD}${SETUP_URL}${RESET}"
  echo -e "    ${BGREEN}3.${RESET}  Claim your instance and create the admin account"
  echo ""
  echo -e "  ${BOLD}${WHITE}Setup token${RESET} ${DIM}(also in .env)${RESET}"
  echo -e "    ${SETUP_TOKEN}"
  echo ""
fi
echo -e "  ${BOLD}${WHITE}PM2 commands${RESET}"
echo -e "    ${DIM}pm2 status${RESET}              Process list"
echo -e "    ${DIM}pm2 logs arciin-web${RESET}      Web logs"
echo -e "    ${DIM}pm2 restart all${RESET}           Restart after .env changes"
echo -e "    ${DIM}bash stop.sh${RESET}                Stop Arciin"
echo -e "    ${DIM}bash start.sh${RESET}               Start Arciin"
echo ""
echo -e "  ${BOLD}${WHITE}LAN access${RESET}"
echo -e "    Web UI:  ${BOLD}http://${LAN_IP}:${WEB_PORT}${RESET}"
echo -e "    API:     ${BOLD}http://${LAN_IP}:${API_PORT}${RESET}  ${DIM}(Python scripts, Socket.IO)${RESET}"
echo -e "    UFW allows TCP ${WEB_PORT}, ${API_PORT}, and mobile (if installed) during install."
echo ""
echo -e "  ${BOLD}${WHITE}Security${RESET}"
echo -e "    ${DIM}.env${RESET} is mode 600; restrict LAN access with UFW if needed; review ${DIM}LICENSE${RESET} for terms."
echo ""
echo -e "  ${BOLD}${WHITE}Important${RESET}"
echo -e "    Do ${BOLD}not${RESET} run ${DIM}pnpm dev${RESET} on this server — use PM2 only (${DIM}bash start.sh${RESET})."
echo -e "    Port conflicts: ${DIM}bash scripts/port-status.sh${RESET}"
echo -e "    After upgrades: ${DIM}bash install.sh${RESET} or ${DIM}pnpm exec prisma migrate deploy${RESET} applies DB changes."
echo -e "    Large uploads need ${DIM}MAX_UPLOAD_SIZE_MB${RESET} in .env (default 20480) and ${DIM}pm2 restart arciin-web${RESET} after changes."
echo -e "    Profile photos: ${DIM}\${ARCIIN_DATA_DIR}/avatars${RESET} — created during init."
echo ""
echo -e "  ${BOLD}${WHITE}Maintenance${RESET}"
echo -e "    ${DIM}bash scripts/arciin-doctor.sh${RESET}        Check everything (services, database login, storage, boot, license)"
echo -e "    ${DIM}./install.sh --repair${RESET}               Repair / upgrade — keeps all data, secrets and license"
echo -e "    ${DIM}./install.sh --fresh${RESET}                Erase the Arciin database and start over (typed confirmation; files kept)"
echo -e "    ${DIM}./install.sh --uninstall${RESET}            Remove Arciin's services; keep database, files and .env"
echo -e "    ${DIM}./install.sh --docker${RESET}               Use Docker instead"
echo -e "    ${DIM}Moving a paid license to a new server? Release the old one at https://arciin.com/account${RESET}"
echo ""

maybe_offer_mobile_install() {
  if [[ ! -t 0 ]]; then
    return 0
  fi

  local mobile_dir="${ROOT_DIR}/../arciin-app"
  if [[ -f "${mobile_dir}/install.sh" ]] && command -v pm2 >/dev/null 2>&1 \
    && pm2 describe arciin-mobile 2>/dev/null | grep -q "online"; then
    ok "Arciin Mobile is already running (../arciin-app)"
    return 0
  fi

  echo ""
  echo -e "  ${BOLD}${WHITE}Install Arciin Mobile (phone PWA)?${RESET}"
  echo -e "  ${DIM}Companion app for uploads and browsing on your phone — same API, no extra database.${RESET}"
  echo ""
  echo -e "    ${BOLD}Yes${RESET}  Clone ${DIM}arciin-app${RESET} next to this repo and run its installer"
  echo -e "    ${BOLD}No${RESET}   Skip for now — install later in the web UI under Integrations"
  echo ""
  read -r -p "  Install mobile app now? [y/N]: " _mobile_yes
  _mobile_yes="${_mobile_yes:-N}"

  if [[ "${_mobile_yes,,}" == "y" || "${_mobile_yes,,}" == "yes" ]]; then
    echo ""
    bash "${ROOT_DIR}/scripts/install-mobile-pwa.sh"
  else
    echo ""
    echo -e "  ${DIM}Skipped mobile install.${RESET} Install anytime from ${BOLD}Integrations → Arciin Mobile${RESET} in the web UI,"
    echo -e "  ${DIM}or run:${RESET}"
    echo -e "       ${DIM}cd ${ROOT_DIR}/../arciin-app && ./install.sh${RESET}"
    echo -e "  ${DIM}Clone:${RESET} ${DIM}https://github.com/Roberadesissaii-arc/arciin-app.git${RESET}"
  fi
}

maybe_offer_mobile_install
