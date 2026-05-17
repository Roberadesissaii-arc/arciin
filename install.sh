#!/usr/bin/env bash
# ================================================================
#  Arciin — Local / WSL Installer
#  Supports: Debian/Ubuntu/WSL (apt)
#  Usage:  bash install.sh              — install or update
#          bash install.sh --reset-db   — drop arciin DB and reinstall schema
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

spin_ok() {
  local label="$1" done_msg="$2"; shift 2
  if spin "$label" "$@"; then
    done_ "$done_msg"
  else
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
  fi
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
  _set_env_kv "$env_file" "ARCIIN_BIND_HOST" "0.0.0.0"
  _set_env_kv "$env_file" "ARCIIN_PUBLIC_URL" "http://${lan_ip}:${web_port}"
  _set_env_kv "$env_file" "ARCIIN_API_URL" "http://127.0.0.1:${api_port}"
  _set_env_kv "$env_file" "API_PORT" "${api_port}"
  _set_env_kv "$env_file" "NEXT_PUBLIC_ARCIIN_API_ORIGIN" ""
  _set_env_kv "$env_file" "NEXT_PUBLIC_SOCKET_URL" ""
  _set_env_kv "$env_file" "NEXT_PUBLIC_ARCIIN_PUBLIC_URL" "http://${lan_ip}:${web_port}"
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
    if command -v ufw >/dev/null 2>&1; then
      sudo ufw allow "${web_port}/tcp" comment "Arciin web UI" &>/dev/null || true
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

configure_app_ports() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "$env_file" ]] || return 0

  local web_port api_port lan_ip saved_web_port saved_api
  lan_ip="$(_detect_lan_ip)"
  web_port="$(_find_free_port "$DEFAULT_WEB_PORT" 3099)"
  api_port="$(_find_free_port "$DEFAULT_API_PORT" 4099)"

  saved_web_port="$(_env_public_url_port "$env_file")"
  saved_api="$(grep -oP '(?<=^API_PORT=)\d+' "$env_file" 2>/dev/null || true)"

  if [[ -n "$saved_web_port" ]] && _port_available "$saved_web_port"; then
    web_port="$saved_web_port"
  elif [[ -n "$saved_web_port" ]]; then
    warn "Web port $saved_web_port is in use — switching to $web_port"
  fi

  if [[ -n "$saved_api" ]] && _port_available "$saved_api"; then
    api_port="$saved_api"
  elif [[ -n "$saved_api" ]]; then
    warn "API port $saved_api is in use — switching to $api_port"
  fi

  _apply_app_ports_to_env "$env_file" "$lan_ip" "$web_port" "$api_port"

  ok "Web UI (LAN)   → http://${lan_ip}:${web_port}"
  ok "Web UI (local) → http://localhost:${web_port}"
  ok "API (internal) → http://127.0.0.1:${api_port}"
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

  chmod 600 "$env_file" 2>/dev/null && ok ".env readable only by you (chmod 600)" || true
}

configure_firewall() {
  local env_file="${ROOT_DIR}/.env"
  local web_port="${ARCIIN_WEB_PORT:-$(_env_public_url_port "$env_file")}"
  web_port="${web_port:-${DEFAULT_WEB_PORT}}"

  if ! command -v ufw >/dev/null 2>&1; then
    if sudo apt-get install -y -qq ufw &>/dev/null; then
      ok "ufw installed"
    else
      warn "ufw not available — open TCP port ${web_port} manually on your firewall"
      return 0
    fi
  fi

  while ! _port_available "$web_port"; do
    warn "Port ${web_port} is in use — trying next port"
    _port_listener_hint "$web_port"
    web_port=$((web_port + 1))
  done

  if [[ "$web_port" != "${ARCIIN_WEB_PORT}" ]]; then
    _apply_app_ports_to_env "$env_file" "$(_detect_lan_ip)" "$web_port" "${ARCIIN_API_PORT:-${DEFAULT_API_PORT}}"
    warn "Updated web port to ${web_port} in .env"
  fi

  spin_ok "Allowing Arciin web port ${web_port}/tcp in UFW..." \
    "Firewall allows port ${web_port}/tcp" \
    sudo ufw allow "${web_port}/tcp" comment "Arciin web UI"

  ok "API (port ${ARCIIN_API_PORT}) binds to 127.0.0.1 — not opened in UFW"

  echo ""
  echo -e "    ${DIM}── sudo ufw status ──${RESET}"
  sudo ufw status 2>/dev/null | sed 's/^/    /' || warn "Could not read ufw status"
}

warn_if_dev_servers_running() {
  if pgrep -f "next dev" &>/dev/null || pgrep -f "tsx watch.*apps/api" &>/dev/null; then
    warn "pnpm dev appears to be running — stop it before production (Ctrl+C or pkill -f 'next dev')"
    warn "Dev and PM2 cannot share the same API/web ports."
  fi
}

launch_pm2() {
  if ! command -v pm2 &>/dev/null; then
    spin_ok "Installing PM2 process manager..." "PM2 installed" npm install -g pm2
  else
    ok "PM2 $(pm2 --version 2>/dev/null | head -1) already installed"
  fi

  warn_if_dev_servers_running

  pm2 stop arciin-web arciin-api arciin-worker &>/dev/null || true
  pm2 delete arciin-web arciin-api arciin-worker &>/dev/null || true

  finalize_ports_before_launch

  mkdir -p "${ROOT_DIR}/logs"
  chmod 700 "${ROOT_DIR}/logs" 2>/dev/null || true

  spin_ok "Building production web bundle..." "Web bundle ready" pnpm build:web

  spin_ok "Starting Arciin (PM2)..." "Arciin started" \
    bash -c "cd \"${ROOT_DIR}\" && pm2 start ecosystem.config.cjs && pm2 save"

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
    ok "Created .env from .env.example"
  else
    ok ".env already exists"
  fi
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

# ── 1. System packages ────────────────────────────────────────────────────────
step "System packages"

spin_ok "Updating package lists..." "Package lists updated" sudo apt-get update -qq

if [[ "${ARCIIN_UPGRADE_SYSTEM:-1}" == "1" ]]; then
  spin_ok "Upgrading installed packages..." "System packages upgraded" sudo apt-get upgrade -y -qq
else
  ok "Skipping apt upgrade (set ARCIIN_UPGRADE_SYSTEM=1 to enable)"
fi

spin_ok "Installing dependencies..." "curl, git, ffmpeg, lsof, PostgreSQL, Redis ready" \
  sudo apt-get install -y -qq \
    ca-certificates curl git gnupg build-essential unzip python3 openssl \
    libssl-dev pkg-config libatomic1 lsof \
    ffmpeg redis-server postgresql postgresql-contrib

# ── 2. Node.js ────────────────────────────────────────────────────────────────
step "Node.js"

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "${NODE_MAJOR}" -ge "${DEFAULT_NODE_MAJOR}" ]]; then
    ok "Node.js $(node -v) already installed"
  else
    spin_ok "Upgrading Node.js to ${DEFAULT_NODE_MAJOR}..." "Node.js $(node -v) ready" \
      bash -c "curl -fsSL https://deb.nodesource.com/setup_${DEFAULT_NODE_MAJOR}.x | sudo -E bash - && sudo apt-get install -y -qq nodejs"
  fi
else
  spin_ok "Installing Node.js ${DEFAULT_NODE_MAJOR}..." "Node.js $(node -v) installed" \
    bash -c "curl -fsSL https://deb.nodesource.com/setup_${DEFAULT_NODE_MAJOR}.x | sudo -E bash - && sudo apt-get install -y -qq nodejs"
fi

# ── 3. pnpm ───────────────────────────────────────────────────────────────────
step "pnpm"

spin_ok "Updating Corepack..." "Corepack ready" sudo npm install --global corepack@latest --silent
corepack enable pnpm
spin_ok "Activating pnpm ${DEFAULT_PNPM_VERSION}..." "pnpm $(pnpm --version) ready" \
  corepack prepare "pnpm@${DEFAULT_PNPM_VERSION}" --activate

# ── 4. Environment ────────────────────────────────────────────────────────────
step "Environment"

ensure_env_file
ensure_session_secret
ensure_setup_token
ensure_production_secrets
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
  "${ROOT_DIR}/scripts/port-status.sh" 2>/dev/null || true

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
echo -e "    ${DIM}API (internal)${RESET} ${BOLD}${WHITE}${API_URL}${RESET}  ${DIM}(port ${API_PORT})${RESET}"
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
echo -e "    Use ${BOLD}http://${LAN_IP}:${WEB_PORT}${RESET} from other devices on your network."
echo -e "    UFW was configured to allow TCP ${WEB_PORT} during install (see step 10)."
echo ""
echo -e "  ${BOLD}${WHITE}Security${RESET}"
echo -e "    ${DIM}.env${RESET} is mode 600; API is loopback-only; review ${DIM}LICENSE${RESET} for terms."
echo ""
echo -e "  ${BOLD}${WHITE}Important${RESET}"
echo -e "    Do ${BOLD}not${RESET} run ${DIM}pnpm dev${RESET} on this server — use PM2 only (${DIM}bash start.sh${RESET})."
echo -e "    Port conflicts: ${DIM}bash scripts/port-status.sh${RESET}"
echo ""
echo -e "  ${BOLD}${WHITE}Options${RESET}"
echo -e "    ${DIM}bash install.sh --reset-db${RESET}            Drop DB and re-run migrations"
echo -e "    ${DIM}ARCIIN_SKIP_PM2=1 ./install.sh${RESET}        Install without PM2"
echo -e "    ${DIM}ARCIIN_SKIP_FIREWALL=1 ./install.sh${RESET}   Skip UFW configuration"
echo -e "    ${DIM}ARCIIN_UPGRADE_SYSTEM=0 ./install.sh${RESET}   Skip apt upgrade"
echo ""
