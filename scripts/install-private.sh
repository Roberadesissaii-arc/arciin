#!/usr/bin/env bash
# ================================================================
#  Arciin — private distribution installer (prototype)
#
#  Customer path (no monorepo):
#    curl -fsSL …/install.sh | bash   # future
#    OR unpack release bundle and: ./install.sh
#
#  Developer path (this monorepo):
#    ./scripts/install-private.sh
#    ARCIIN_INSTALL_DIR=/srv/arciin ./scripts/install-private.sh
#
#  Does NOT: Stripe, real license cloud, public registry publish.
# ================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# When run from monorepo scripts/, root is parent; when copied into a
# customer release bundle, SCRIPT_DIR is the install root.
if [[ -f "${SCRIPT_DIR}/../docker-compose.production.yml" ]]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
  BUNDLE_MODE=0
elif [[ -f "${SCRIPT_DIR}/docker-compose.yml" ]] || [[ -f "${SCRIPT_DIR}/docker-compose.production.yml" ]]; then
  REPO_ROOT="${SCRIPT_DIR}"
  BUNDLE_MODE=1
else
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
  BUNDLE_MODE=0
fi

INSTALL_DIR="${ARCIIN_INSTALL_DIR:-/srv/arciin}"
STORAGE_DIR="${ARCIIN_HOST_DATA_DIR:-/srv/arciin-storage/arciin}"
COMPOSE_FILE_NAME="docker-compose.yml"
ENV_FILE_NAME=".env"

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
info() { echo -e "  ${DIM}$1${RESET}"; }

docker_compose_cmd() {
  if docker compose version &>/dev/null; then
    echo "docker compose"
  elif command -v docker-compose &>/dev/null; then
    echo "docker-compose"
  else
    return 1
  fi
}

_rand_hex() {
  local bytes="${1:-32}"
  if command -v openssl &>/dev/null; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | xxd -p -c $((bytes * 2))
  fi
}

_ensure_env_kv() {
  local env_file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    # Only replace empty / placeholder values
    local current
    current="$(grep "^${key}=" "$env_file" | head -1 | cut -d= -f2-)"
    if [[ -z "$current" || "$current" == "change-me" || "$current" == "change-this-in-production" ]]; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
    fi
  else
    echo "${key}=${value}" >>"$env_file"
  fi
}

_force_env_kv() {
  local env_file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >>"$env_file"
  fi
}

_mkdir_owned() {
  local path="$1"
  if mkdir -p "$path" 2>/dev/null; then
    return 0
  fi
  if command -v sudo &>/dev/null; then
    sudo mkdir -p "$path"
    sudo chown -R "$(id -u):$(id -g)" "$path"
    return 0
  fi
  return 1
}

echo ""
echo -e "  ${BOLD}${WHITE}Arciin — private distribution installer${RESET}"
echo -e "  ${DIM}Prototype: image-based install (no source monorepo required)${RESET}"
echo ""

if ! command -v docker &>/dev/null; then
  echo -e "  Docker is not installed."
  echo ""
  echo -e "    curl -fsSL https://get.docker.com | sh"
  echo -e "    sudo usermod -aG docker \$USER"
  echo -e "    ${DIM}Log out and back in, then re-run this installer${RESET}"
  exit 1
fi

COMPOSE="$(docker_compose_cmd)" || fail "Docker Compose v2 is required (docker-compose-plugin)."

# ── Layout ──────────────────────────────────────────────────────────────────
info "Install dir:  ${INSTALL_DIR}"
info "Storage dir:  ${STORAGE_DIR}"

_mkdir_owned "$INSTALL_DIR" || fail "Cannot create ${INSTALL_DIR}"
_mkdir_owned "$STORAGE_DIR" || fail "Cannot create ${STORAGE_DIR}"
_mkdir_owned "${STORAGE_DIR}/objects"
_mkdir_owned "${STORAGE_DIR}/libraries"
_mkdir_owned "${STORAGE_DIR}/thumbnails"
_mkdir_owned "${STORAGE_DIR}/temp"
_mkdir_owned "${STORAGE_DIR}/logs"
ok "Created install + storage directories"

# ── Compose + Caddyfile ─────────────────────────────────────────────────────
SRC_COMPOSE=""
SRC_ENV_EXAMPLE=""
SRC_CADDY=""

if [[ "$BUNDLE_MODE" -eq 1 ]]; then
  if [[ -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    SRC_COMPOSE="${REPO_ROOT}/docker-compose.yml"
  elif [[ -f "${REPO_ROOT}/docker-compose.production.yml" ]]; then
    SRC_COMPOSE="${REPO_ROOT}/docker-compose.production.yml"
  fi
  SRC_ENV_EXAMPLE="${REPO_ROOT}/.env.example"
  [[ -f "${REPO_ROOT}/.env.production.example" ]] && SRC_ENV_EXAMPLE="${REPO_ROOT}/.env.production.example"
  if [[ -f "${REPO_ROOT}/Caddyfile" ]]; then
    SRC_CADDY="${REPO_ROOT}/Caddyfile"
  elif [[ -f "${REPO_ROOT}/docker/caddy/Caddyfile" ]]; then
    SRC_CADDY="${REPO_ROOT}/docker/caddy/Caddyfile"
  fi
else
  SRC_COMPOSE="${REPO_ROOT}/docker-compose.production.yml"
  SRC_ENV_EXAMPLE="${REPO_ROOT}/.env.production.example"
  SRC_CADDY="${REPO_ROOT}/docker/caddy/Caddyfile"
fi

[[ -f "$SRC_COMPOSE" ]] || fail "Missing compose file (expected docker-compose.production.yml)"
[[ -f "$SRC_ENV_EXAMPLE" ]] || fail "Missing env template (.env.production.example)"
[[ -f "$SRC_CADDY" ]] || fail "Missing Caddyfile"

cp "$SRC_COMPOSE" "${INSTALL_DIR}/${COMPOSE_FILE_NAME}"
ok "Installed ${COMPOSE_FILE_NAME}"

mkdir -p "${INSTALL_DIR}/docker/caddy"
cp "$SRC_CADDY" "${INSTALL_DIR}/docker/caddy/Caddyfile"
ok "Installed Caddyfile"

# ── .env ────────────────────────────────────────────────────────────────────
ENV_PATH="${INSTALL_DIR}/${ENV_FILE_NAME}"
if [[ ! -f "$ENV_PATH" ]]; then
  cp "$SRC_ENV_EXAMPLE" "$ENV_PATH"
  ok "Created .env from template"
else
  warn ".env already exists — keeping values, filling blanks only"
fi

_force_env_kv "$ENV_PATH" "ARCIIN_HOST_DATA_DIR" "$STORAGE_DIR"
_force_env_kv "$ENV_PATH" "ARCIIN_DATA_DIR" "/data/arciin"
_force_env_kv "$ENV_PATH" "NODE_ENV" "production"
_ensure_env_kv "$ENV_PATH" "ARCIIN_PUID" "$(id -u)"
_ensure_env_kv "$ENV_PATH" "ARCIIN_PGID" "$(id -g)"

if ! grep -qE '^ARCIIN_SETUP_TOKEN=.+' "$ENV_PATH" 2>/dev/null || grep -qE '^ARCIIN_SETUP_TOKEN=(change-me)?$' "$ENV_PATH"; then
  _force_env_kv "$ENV_PATH" "ARCIIN_SETUP_TOKEN" "$(_rand_hex 24)"
  ok "Generated ARCIIN_SETUP_TOKEN"
fi

if ! grep -qE '^SESSION_SECRET=.+' "$ENV_PATH" 2>/dev/null || grep -qE '^SESSION_SECRET=(change-me|change-this-in-production)?$' "$ENV_PATH"; then
  _force_env_kv "$ENV_PATH" "SESSION_SECRET" "$(_rand_hex 32)"
  ok "Generated SESSION_SECRET"
fi

if ! grep -qE '^ARCIIN_ENCRYPTION_KEY=.+' "$ENV_PATH" 2>/dev/null || grep -qE '^ARCIIN_ENCRYPTION_KEY=(change-me)?$' "$ENV_PATH"; then
  _force_env_kv "$ENV_PATH" "ARCIIN_ENCRYPTION_KEY" "$(_rand_hex 32)"
  ok "Generated ARCIIN_ENCRYPTION_KEY"
fi

if ! grep -qE '^POSTGRES_PASSWORD=.+' "$ENV_PATH" 2>/dev/null || grep -qE '^POSTGRES_PASSWORD=(change-me|arciin)?$' "$ENV_PATH"; then
  _force_env_kv "$ENV_PATH" "POSTGRES_PASSWORD" "$(_rand_hex 24)"
  ok "Generated POSTGRES_PASSWORD"
fi

if ! grep -qE '^REDIS_PASSWORD=.+' "$ENV_PATH" 2>/dev/null || grep -qE '^REDIS_PASSWORD=(change-me)?$' "$ENV_PATH"; then
  _force_env_kv "$ENV_PATH" "REDIS_PASSWORD" "$(_rand_hex 24)"
  ok "Generated REDIS_PASSWORD"
fi

chmod 600 "$ENV_PATH" 2>/dev/null || true

# Fix bind-mount ownership for non-root containers
if command -v sudo &>/dev/null; then
  puid="$(grep '^ARCIIN_PUID=' "$ENV_PATH" | cut -d= -f2-)"
  pgid="$(grep '^ARCIIN_PGID=' "$ENV_PATH" | cut -d= -f2-)"
  sudo chown -R "${puid}:${pgid}" "$STORAGE_DIR" 2>/dev/null || true
fi

SETUP_TOKEN="$(grep '^ARCIIN_SETUP_TOKEN=' "$ENV_PATH" | cut -d= -f2-)"
PUBLIC_URL="$(grep '^ARCIIN_PUBLIC_URL=' "$ENV_PATH" | cut -d= -f2- || true)"
PUBLIC_URL="${PUBLIC_URL:-http://localhost}"
HTTP_PORT="$(grep '^ARCIIN_HTTP_PORT=' "$ENV_PATH" 2>/dev/null | cut -d= -f2- || true)"
HTTP_PORT="${HTTP_PORT:-${ARCIIN_HTTP_PORT:-80}}"

# ── Firewall (new servers often block browser ports by default) ─────────────
if [[ "${ARCIIN_SKIP_FIREWALL:-0}" != "1" ]]; then
  FW_LIB=""
  if [[ -f "${REPO_ROOT}/scripts/lib/open-firewall-ports.sh" ]]; then
    FW_LIB="${REPO_ROOT}/scripts/lib/open-firewall-ports.sh"
  elif [[ -f "${INSTALL_DIR}/scripts/lib/open-firewall-ports.sh" ]]; then
    FW_LIB="${INSTALL_DIR}/scripts/lib/open-firewall-ports.sh"
  fi
  if [[ -n "$FW_LIB" ]]; then
    # shellcheck source=scripts/lib/open-firewall-ports.sh
    source "$FW_LIB"
    echo ""
    echo -e "  ${BOLD}Firewall${RESET} ${DIM}(open HTTP so LAN browsers can load Arciin)${RESET}"
    arciin_open_firewall_ports "$HTTP_PORT" 80 443 || true
    ok "Firewall rules applied for HTTP port ${HTTP_PORT}"
  else
    warn "Firewall helper missing — open TCP ${HTTP_PORT} manually if the UI is unreachable"
  fi
fi

# ── Images ──────────────────────────────────────────────────────────────────
cd "$INSTALL_DIR"
export ARCIIN_HOST_DATA_DIR="$STORAGE_DIR"

echo ""
if [[ "${ARCIIN_SKIP_PULL:-0}" == "1" ]]; then
  warn "Skipping docker compose pull (ARCIIN_SKIP_PULL=1) — using local images"
else
  echo -e "  ${BOLD}Pulling images…${RESET}"
  if ! ${COMPOSE} --env-file "$ENV_PATH" -f "${COMPOSE_FILE_NAME}" pull 2>/dev/null; then
    warn "Pull failed or images not on a registry yet."
    warn "For local prototype, build on a machine with the monorepo:"
    info "  cd /path/to/arciin && pnpm docker:build"
    info "  # then re-run installer with ARCIIN_SKIP_PULL=1"
    if ! docker image inspect arciin/arciin-web:latest &>/dev/null \
      || ! docker image inspect arciin/arciin-api:latest &>/dev/null \
      || ! docker image inspect arciin/arciin-worker:latest &>/dev/null; then
      # If we're still next to the monorepo, offer to build
      if [[ "$BUNDLE_MODE" -eq 0 && -f "${REPO_ROOT}/scripts/docker-build-images.sh" ]]; then
        echo ""
        echo -e "  ${BOLD}Building local images from monorepo…${RESET}"
        (cd "$REPO_ROOT" && bash scripts/docker-build-images.sh) || fail "Image build failed"
      else
        fail "Required images missing. Build locally or configure a private registry."
      fi
    else
      ok "Local images already present"
    fi
  else
    ok "Images pulled"
  fi
fi

echo ""
echo -e "  ${BOLD}Starting stack…${RESET}"
${COMPOSE} --env-file "$ENV_PATH" -f "${COMPOSE_FILE_NAME}" up -d

echo ""
echo -e "  ${GREEN}${BOLD}Arciin is running${RESET}"
echo ""
echo -e "    ${DIM}Web UI${RESET}        ${BOLD}http://localhost${RESET}  ${DIM}(Caddy :80)${RESET}"
if [[ "$PUBLIC_URL" != "http://localhost" && "$PUBLIC_URL" != "http://localhost:80" ]]; then
  echo -e "    ${DIM}Public URL${RESET}    ${BOLD}${PUBLIC_URL}${RESET}"
fi
echo -e "    ${DIM}Files${RESET}         ${BOLD}${STORAGE_DIR}${RESET}"
echo -e "    ${DIM}Config${RESET}        ${BOLD}${INSTALL_DIR}${RESET}"
echo -e "    ${DIM}Setup${RESET}         ${BOLD}${PUBLIC_URL%/}/setup?token=${SETUP_TOKEN}${RESET}"
echo ""
echo -e "  ${BOLD}Next steps${RESET}"
echo -e "    1. Open the setup URL and create the owner account"
echo -e "    2. Use free core: libraries, uploads, files (always available)"
echo -e "    3. Settings → License → activate a demo key to unlock paid UI"
echo -e "       ${DIM}e.g. ARCIIN-DEV-PRO or arc_demo_pro_… from the marketing demo portal${RESET}"
echo -e "    4. Deactivate later to confirm paid features lock again"
echo ""
echo -e "  ${BOLD}Commands${RESET}  ${DIM}(run from ${INSTALL_DIR})${RESET}"
echo -e "    ${DIM}${COMPOSE} ps${RESET}"
echo -e "    ${DIM}${COMPOSE} logs -f api${RESET}"
echo -e "    ${DIM}${COMPOSE} down${RESET}"
echo -e "    ${DIM}${COMPOSE} pull && ${COMPOSE} up -d${RESET}   ${DIM}# updates when registry is ready${RESET}"
echo ""
echo -e "  ${DIM}Docs: docs/PRIVATE_DISTRIBUTION.md${RESET}"
echo ""
