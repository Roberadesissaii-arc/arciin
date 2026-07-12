#!/usr/bin/env bash
# ================================================================
#  Arciin — Local / WSL Installer
#  Supports: Debian/Ubuntu/WSL (apt)
#  Usage:  bash install.sh              — install or update (native / PM2)
#          bash install.sh --docker     — Docker Compose (any Linux with Docker)
#          bash install.sh --reset-db   — drop arciin DB and reinstall schema
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/lib/host-platform.sh
source "${ROOT_DIR}/scripts/lib/host-platform.sh"
# shellcheck source=scripts/lib/storage-defaults.sh
source "${ROOT_DIR}/scripts/lib/storage-defaults.sh"

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

for _arg in "$@"; do
  case "$_arg" in
    --docker|-d) ARCIIN_INSTALL_MODE=docker ;;
    --help|-h)
      echo "Usage: ./install.sh [--docker] [--reset-db]"
      echo "  --docker     Run scripts/docker-setup.sh (Compose + bind-mounted storage)"
      echo "  --reset-db   Drop and recreate the arciin PostgreSQL database (native only)"
      echo ""
      echo "Environment:"
      echo "  ARCIIN_INSTALL_MODE=docker     Same as --docker"
      echo "  ARCIIN_SKIP_SYSTEM_PACKAGES=1  Skip apt install (native; deps must exist)"
      echo "  ARCIIN_SKIP_INSTALL_CHOICE=1   Skip Docker vs native menu"
      exit 0
      ;;
  esac
done

if [[ "${ARCIIN_INSTALL_MODE:-}" == "docker" ]]; then
  exec "${ROOT_DIR}/scripts/docker-setup.sh"
fi
DEFAULT_NODE_MAJOR=24
DEFAULT_PNPM_VERSION=10.32.1
DEFAULT_WEB_PORT=3000
DEFAULT_API_PORT=4000
DEFAULT_PG_PORT=5432
ARCIIN_PG_PORT="${DEFAULT_PG_PORT}"

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

TOTAL_STEPS=11
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
    if sudo apt-get install -y -qq "$@"; then
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
for arg in "$@"; do
  [[ "$arg" == "--reset-db" ]] && RESET_DB=true
done

# ── Banner ────────────────────────────────────────────────────────────────────
clear
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
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{
    for (i = 1; i <= NF; i++)
      if ($i !~ /^127\./) { print $i; exit }
  }')"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return
  fi
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") { print $(i+1); exit }}')"
  [[ -n "$ip" ]] && echo "$ip" || echo "127.0.0.1"
}

_env_public_url_port() {
  grep '^ARCIIN_PUBLIC_URL=' "$1" 2>/dev/null | sed -n 's|.*:\([0-9][0-9]*\)$|\1|p' | head -1
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
  secret_len="$(grep '^SESSION_SECRET=' "$env_file" 2>/dev/null | cut -d= -f2- | wc -c | tr -d ' ')"
  if grep -q '^SESSION_SECRET=change-this-in-production' "$env_file" 2>/dev/null \
    || [[ "${secret_len:-0}" -lt 32 ]]; then
    _set_env_kv "$env_file" "SESSION_SECRET" "$(_gen_secret)"
    ok "SESSION_SECRET secured (random)"
  fi

  if grep -qE '^ARCIIN_SETUP_TOKEN=(dev-token)?$' "$env_file" 2>/dev/null \
    || grep -q '^ARCIIN_SETUP_TOKEN=$' "$env_file" 2>/dev/null; then
    _set_env_kv "$env_file" "ARCIIN_SETUP_TOKEN" "$(openssl rand -hex 24 2>/dev/null || _gen_secret)"
    ok "ARCIIN_SETUP_TOKEN secured (random)"
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

stop_dev_servers() {
  if ! pgrep -f "next dev" &>/dev/null && ! pgrep -f "tsx watch" &>/dev/null; then
    return 0
  fi
  warn "Stopping pnpm dev (it blocks production ports)..."
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "tsx watch" 2>/dev/null || true
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

launch_pm2() {
  if ! command -v pm2 &>/dev/null; then
    spin_ok "Installing PM2 process manager..." "PM2 installed" npm install -g pm2
  else
    ok "PM2 $(pm2 --version 2>/dev/null | head -1) already installed"
  fi

  stop_existing_arciin

  finalize_ports_before_launch

  mkdir -p "${ROOT_DIR}/logs"
  chmod 700 "${ROOT_DIR}/logs" 2>/dev/null || true

  spin_ok "Building production bundles (web, API, worker)..." "Production build ready" \
    bash -c "cd \"${ROOT_DIR}\" && pnpm build"

  spin_ok "Starting Arciin (PM2)..." "PM2 processes started" \
    bash -c "cd \"${ROOT_DIR}\" && pm2 start ecosystem.config.cjs && pm2 save"

  wait_for_api_health || warn "Web UI may show 'waiting for API' until arciin-api is fixed"

  if command -v systemctl >/dev/null 2>&1; then
    spin_ok "Configuring auto-start on boot..." "Auto-start configured" \
      bash -c 'PM2_STARTUP="$(pm2 startup 2>&1 | grep sudo | tail -1 || true)"; [[ -n "$PM2_STARTUP" ]] && eval "$PM2_STARTUP" || true'
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

  _set_env_kv "$env_file" "DATABASE_URL" "postgresql://arciin:arciin@localhost:${pg_port}/arciin"
  _set_env_kv "$env_file" "ARCIIN_PG_PORT" "${pg_port}"

  if pg_isready -h localhost -p "$pg_port" &>/dev/null 2>&1; then
    ok "PostgreSQL → localhost:${pg_port}"
  else
    warn "PostgreSQL is not responding on localhost:${pg_port}"
  fi
}

_gen_secret() {
  openssl rand -base64 32 2>/dev/null | tr -d '\n=' || \
    head -c 32 /dev/urandom | base64 2>/dev/null | tr -d '\n=' || \
    echo "changeme-$(date +%s)-$(( RANDOM * RANDOM ))"
}

ensure_env_file() {
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

  local resolved
  resolved="$(_arciin_setup_host_storage "${ROOT_DIR}" "$preset" "${env_file}" 0)" \
    || fail "Could not set up file storage."

  _set_env_kv "$env_file" "ARCIIN_DATA_DIR" "$resolved"
  ok "File storage: ${resolved}"
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
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files >/dev/null 2>&1; then
    sudo systemctl enable --now "$service_name" &>/dev/null || warn "Could not enable/start ${service_name}"
  else
    sudo service "$service_name" start &>/dev/null || warn "Could not start ${service_name}"
  fi
}

ensure_postgres_role_and_db() {
  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found — skipping PostgreSQL role/database setup"
    return 0
  fi

  local pg_port="${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}"
  export PGPORT="$pg_port"

  if $RESET_DB; then
    spin_ok "Dropping existing arciin database..." "Database dropped" \
      bash -c "sudo -u postgres env PGPORT='${pg_port}' psql -c \"DROP DATABASE IF EXISTS arciin;\" && \
        sudo -u postgres env PGPORT='${pg_port}' psql -c \"DROP ROLE IF EXISTS arciin;\"" || true
  fi

  if sudo -u postgres env PGPORT="$pg_port" psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='arciin'" | grep -q 1; then
    sudo -u postgres env PGPORT="$pg_port" psql -c "ALTER ROLE arciin WITH LOGIN PASSWORD 'arciin' CREATEDB;" &>/dev/null
  else
    sudo -u postgres env PGPORT="$pg_port" psql -c "CREATE ROLE arciin WITH LOGIN PASSWORD 'arciin' CREATEDB;" &>/dev/null
  fi

  if sudo -u postgres env PGPORT="$pg_port" psql -tAc "SELECT 1 FROM pg_database WHERE datname='arciin'" | grep -q 1; then
    sudo -u postgres env PGPORT="$pg_port" psql -c "ALTER DATABASE arciin OWNER TO arciin;" &>/dev/null
  else
    sudo -u postgres env PGPORT="$pg_port" psql -c "CREATE DATABASE arciin OWNER arciin;" &>/dev/null
  fi

  sudo -u postgres env PGPORT="$pg_port" psql -d arciin -c "GRANT ALL ON SCHEMA public TO arciin;" &>/dev/null || true
  ok "PostgreSQL role/database: arciin / arciin (port ${pg_port})"
}

# ── Preconditions ─────────────────────────────────────────────────────────────
if [[ "${EUID}" -eq 0 ]]; then
  fail "Run this script as your normal user, not as root."
fi

if ! command -v apt-get >/dev/null 2>&1; then
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

# ── 1. System packages ────────────────────────────────────────────────────────
step "System packages"

_apt_install_system_deps() {
  local log held
  log="$(mktemp)"
  if sudo apt-get install -y -qq \
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

  if [[ "${ARCIIN_UPGRADE_SYSTEM:-1}" == "1" ]]; then
    spin_ok "Upgrading installed packages..." "System packages upgraded" sudo apt-get upgrade -y -qq
  else
    ok "Skipping apt upgrade (set ARCIIN_UPGRADE_SYSTEM=1 to enable)"
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
ensure_arciin_storage_path
ensure_session_secret
ensure_setup_token
ensure_production_secrets
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
fi

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

chmod +x "${ROOT_DIR}/start.sh" "${ROOT_DIR}/stop.sh" \
  "${ROOT_DIR}/scripts/start.sh" "${ROOT_DIR}/scripts/stop.sh" \
  "${ROOT_DIR}/scripts/port-status.sh" \
  "${ROOT_DIR}/scripts/run-api-prod.sh" \
  "${ROOT_DIR}/scripts/run-worker-prod.sh" 2>/dev/null || true

# ── 10. Production launch (PM2) ─────────────────────────────────────────────
step "Production launch"

if [[ "${ARCIIN_SKIP_PM2:-0}" == "1" ]]; then
  warn "Skipping PM2 launch (ARCIIN_SKIP_PM2=1) — run: pnpm build:web && pm2 start ecosystem.config.cjs"
else
  launch_pm2
fi

# ── 11. Summary ───────────────────────────────────────────────────────────────
step "Ready"

ENV_FILE="${ROOT_DIR}/.env"
SETUP_TOKEN="$(grep '^ARCIIN_SETUP_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo 'dev-token')"
PUBLIC_URL="$(grep '^ARCIIN_PUBLIC_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "http://localhost:${DEFAULT_WEB_PORT}")"
LOCAL_URL="http://localhost:$(_env_public_url_port "$ENV_FILE" 2>/dev/null || echo "${DEFAULT_WEB_PORT}")"
API_URL="$(grep '^ARCIIN_API_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "http://127.0.0.1:${DEFAULT_API_PORT}")"
WEB_PORT="$(_env_public_url_port "$ENV_FILE" 2>/dev/null || echo "${DEFAULT_WEB_PORT}")"
API_PORT="$(grep '^API_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "${DEFAULT_API_PORT}")"
PG_PORT="$(grep '^ARCIIN_PG_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "${ARCIIN_PG_PORT:-${DEFAULT_PG_PORT}}")"
SETUP_URL="${PUBLIC_URL}/setup?token=${SETUP_TOKEN}"
LAN_IP="$(_detect_lan_ip)"

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
echo -e "    ${BGREEN}1.${RESET}  Arciin is running under ${BOLD}PM2${RESET} (production, auto-restart on boot)"
echo -e "    ${BGREEN}2.${RESET}  Open from this machine or LAN:  ${BOLD}${SETUP_URL}${RESET}"
echo -e "    ${BGREEN}3.${RESET}  Claim your instance and create the admin account"
echo ""
echo -e "  ${BOLD}${WHITE}Setup token${RESET} ${DIM}(also in .env)${RESET}"
echo -e "    ${SETUP_TOKEN}"
echo ""
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
echo -e "  ${BOLD}${WHITE}Options${RESET}"
echo -e "    ${DIM}bash install.sh --reset-db${RESET}            Drop DB and re-run migrations"
echo -e "    ${DIM}ARCIIN_SKIP_PM2=1 ./install.sh${RESET}        Install without PM2"
echo -e "    ${DIM}ARCIIN_SKIP_FIREWALL=1 ./install.sh${RESET}   Skip UFW configuration"
echo -e "    ${DIM}ARCIIN_UPGRADE_SYSTEM=0 ./install.sh${RESET}   Skip apt upgrade"
echo -e "    ${DIM}./install.sh --docker${RESET}                  Docker (avoid host apt stack)"
echo -e "    ${DIM}ARCIIN_SKIP_SYSTEM_PACKAGES=1 ./install.sh${RESET}  Skip apt deps (native only)"
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
