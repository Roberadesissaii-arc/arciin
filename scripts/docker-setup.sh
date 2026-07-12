#!/usr/bin/env bash
# ================================================================
#  Arciin — Docker / Compose setup (Linux, any hardware)
#  Usage:  ./scripts/docker-setup.sh
#          ARCIIN_HOST_DATA_DIR=/mnt/ssd/arciin ./scripts/docker-setup.sh
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

# shellcheck source=scripts/lib/host-platform.sh
source "${ROOT_DIR}/scripts/lib/host-platform.sh"
# shellcheck source=scripts/lib/storage-defaults.sh
source "${ROOT_DIR}/scripts/lib/storage-defaults.sh"
# shellcheck source=scripts/lib/docker-build-context.sh
source "${ROOT_DIR}/scripts/lib/docker-build-context.sh"

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
DIM="\033[2m"
WHITE="\033[97m"
RESET="\033[0m"

ok()   { echo -e "  ${GREEN}✔${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✖${RESET}  $1"; exit 1; }

docker_compose_cmd() {
  if docker compose version &>/dev/null; then
    echo "docker compose"
  elif command -v docker-compose &>/dev/null; then
    echo "docker-compose"
  else
    return 1
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

_ensure_env_kv() {
  local env_file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >>"$env_file"
  fi
}

echo ""
echo -e "  ${BOLD}${WHITE}Arciin — Docker setup${RESET}"
echo -e "  ${DIM}Host:${RESET} $(host_display_name)"
echo ""

if ! command -v docker &>/dev/null; then
  echo -e "  Docker is not installed."
  echo ""
  echo -e "    curl -fsSL https://get.docker.com | sh"
  echo -e "    sudo usermod -aG docker \$USER"
  echo -e "    ${DIM}Log out and back in, then re-run:${RESET} ./scripts/docker-setup.sh"
  echo -e "    ${DIM}https://docs.docker.com/engine/install/${RESET}"
  exit 1
fi

COMPOSE="$(docker_compose_cmd)" || fail "Docker Compose v2 is required (install the docker-compose-plugin package)."

warn "First ${BOLD}docker compose build${RESET} may take several minutes on this host."

# ── .env (bootstrap before storage so migration can read prior paths) ───────
ENV_FILE="${ROOT_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "${ROOT_DIR}/.env.docker.example" ]]; then
    cp "${ROOT_DIR}/.env.docker.example" "$ENV_FILE"
    ok "Created .env from .env.docker.example"
  else
    cp "${ROOT_DIR}/.env.example" "$ENV_FILE"
    warn "Using .env.example — review Docker-specific keys"
  fi
fi

# ── Storage path (create folder, migrate legacy data, prepare layout) ───────
PRESET_HOST_DATA="${ARCIIN_HOST_DATA_DIR:-}"
if [[ -z "$PRESET_HOST_DATA" ]]; then
  PRESET_HOST_DATA="$(grep '^ARCIIN_HOST_DATA_DIR=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
fi
if [[ "$PRESET_HOST_DATA" == "./data/arciin" ]] || [[ "$PRESET_HOST_DATA" == "${ROOT_DIR}/data/arciin" ]]; then
  PRESET_HOST_DATA=""
fi

echo -e "  ${BOLD}Storage${RESET}"
HOST_DATA="$(_arciin_setup_host_storage "${ROOT_DIR}" "$PRESET_HOST_DATA" "$ENV_FILE" 1)" \
  || fail "Could not set up storage at ${ARCIIN_DEFAULT_STORAGE}"
ok "Storage directory: ${HOST_DATA}"

LAN_IP="$(_detect_lan_ip)"
_ensure_env_kv "$ENV_FILE" "ARCIIN_HOST_DATA_DIR" "$HOST_DATA"
_ensure_env_kv "$ENV_FILE" "NODE_ENV" "production"

if grep -qE '^ARCIIN_SETUP_TOKEN=(dev-token|change-me)?$' "$ENV_FILE" 2>/dev/null || ! grep -q '^ARCIIN_SETUP_TOKEN=' "$ENV_FILE"; then
  token="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p -c 48)"
  _ensure_env_kv "$ENV_FILE" "ARCIIN_SETUP_TOKEN" "$token"
  ok "Generated ARCIIN_SETUP_TOKEN"
fi

if grep -qE '^SESSION_SECRET=(change-this-in-production|change-me)?$' "$ENV_FILE" 2>/dev/null || ! grep -q '^SESSION_SECRET=' "$ENV_FILE"; then
  secret="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
  _ensure_env_kv "$ENV_FILE" "SESSION_SECRET" "$secret"
  ok "Generated SESSION_SECRET"
fi

# Dedicated data-encryption key (vault/webhook/integration secrets at rest).
if grep -qE '^ARCIIN_ENCRYPTION_KEY=(change-me)?$' "$ENV_FILE" 2>/dev/null || ! grep -q '^ARCIIN_ENCRYPTION_KEY=' "$ENV_FILE"; then
  enckey="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
  _ensure_env_kv "$ENV_FILE" "ARCIIN_ENCRYPTION_KEY" "$enckey"
  ok "Generated ARCIIN_ENCRYPTION_KEY"
fi

# Database + cache passwords (no longer hardcoded in docker-compose.yml).
if grep -qE '^POSTGRES_PASSWORD=(change-me|arciin)?$' "$ENV_FILE" 2>/dev/null || ! grep -q '^POSTGRES_PASSWORD=' "$ENV_FILE"; then
  pgpw="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p -c 48)"
  _ensure_env_kv "$ENV_FILE" "POSTGRES_PASSWORD" "$pgpw"
  ok "Generated POSTGRES_PASSWORD"
fi

if grep -qE '^REDIS_PASSWORD=(change-me)?$' "$ENV_FILE" 2>/dev/null || ! grep -q '^REDIS_PASSWORD=' "$ENV_FILE"; then
  redispw="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p -c 48)"
  _ensure_env_kv "$ENV_FILE" "REDIS_PASSWORD" "$redispw"
  ok "Generated REDIS_PASSWORD"
fi

# Align the container uid with the host user that owns the storage bind-mount.
if ! grep -q '^ARCIIN_PUID=' "$ENV_FILE"; then
  _ensure_env_kv "$ENV_FILE" "ARCIIN_PUID" "$(id -u)"
  _ensure_env_kv "$ENV_FILE" "ARCIIN_PGID" "$(id -g)"
  ok "Pinned container uid/gid to the host user"
fi

if grep -qE '^ARCIIN_PUBLIC_URL=http://localhost(:3000)?$' "$ENV_FILE" 2>/dev/null; then
  if [[ -t 0 ]]; then
    echo ""
    read -r -p "  Use LAN URL http://${LAN_IP} for phones/tablets? [Y/n]: " use_lan
    if [[ ! "$use_lan" =~ ^[Nn] ]]; then
      _ensure_env_kv "$ENV_FILE" "ARCIIN_PUBLIC_URL" "http://${LAN_IP}"
    fi
  fi
fi

chmod 600 "$ENV_FILE" 2>/dev/null || true

SETUP_TOKEN="$(grep '^ARCIIN_SETUP_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
PUBLIC_URL="$(grep '^ARCIIN_PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2-)"

# ── Firewall (browser access from LAN / internet) ─────────────────────────────
if [[ "${ARCIIN_SKIP_FIREWALL:-0}" != "1" ]]; then
  # shellcheck source=scripts/lib/open-firewall-ports.sh
  source "${ROOT_DIR}/scripts/lib/open-firewall-ports.sh"
  http_port="$(grep -E '^ARCIIN_HTTP_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  http_port="${http_port:-${ARCIIN_HTTP_PORT:-80}}"
  echo ""
  echo -e "  ${BOLD}Firewall${RESET} ${DIM}(open HTTP so phones/PCs can open the app)${RESET}"
  # Docker customers need Caddy HTTP; also open platform ports if this host runs account/license server
  arciin_open_firewall_ports "$http_port" 80 443 || true
  # Optional: when developing account + license on same host
  if [[ "${ARCIIN_OPEN_PLATFORM_PORTS:-1}" == "1" ]]; then
    arciin_open_firewall_ports 3010 4100 || true
  fi
fi

# ── Build & start ─────────────────────────────────────────────────────────────
arciin_docker_warn_repo_media "$ROOT_DIR" "$HOST_DATA"

echo ""
echo -e "  ${BOLD}Starting Docker stack…${RESET}"
echo -e "  ${DIM}${COMPOSE} up --build -d${RESET}"
echo ""

export ARCIIN_HOST_DATA_DIR="$HOST_DATA"

_arciin_docker_build_cleanup() {
  arciin_docker_restore_repo_media "$ROOT_DIR"
}
trap _arciin_docker_build_cleanup EXIT
arciin_docker_stash_repo_media "$ROOT_DIR" || true

${COMPOSE} --env-file "$ENV_FILE" up --build -d

echo ""
echo -e "  ${GREEN}${BOLD}Arciin is running in Docker${RESET}"
echo ""
echo -e "    ${DIM}Web UI${RESET}       ${BOLD}http://localhost${RESET}  ${DIM}(Caddy :80)${RESET}"
if [[ "$PUBLIC_URL" != "http://localhost" ]]; then
  echo -e "    ${DIM}LAN URL${RESET}      ${BOLD}${PUBLIC_URL}${RESET}"
fi
echo -e "    ${DIM}Your files${RESET}   ${BOLD}${HOST_DATA}${RESET}"
echo -e "    ${DIM}Setup${RESET}        ${BOLD}${PUBLIC_URL%/}/setup?token=${SETUP_TOKEN}${RESET}"
echo ""
echo -e "  ${BOLD}Setup token${RESET} ${DIM}(.env)${RESET}"
echo -e "    ${SETUP_TOKEN}"
echo ""
echo -e "  ${BOLD}Commands${RESET}"
echo -e "    ${DIM}${COMPOSE} ps${RESET}              Status"
echo -e "    ${DIM}${COMPOSE} logs -f api${RESET}     API logs"
echo -e "    ${DIM}${COMPOSE} down${RESET}            Stop"
echo -e "    ${DIM}${COMPOSE} pull && ${COMPOSE} up -d${RESET}  Update images"
echo ""
echo -e "  ${DIM}Docs: docs/DOCKER.md${RESET}"
echo ""
