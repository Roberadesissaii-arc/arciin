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

_can_use_storage_path() {
  local path="$1"
  if [[ -d "$path" ]] && [[ -w "$path" ]]; then
    return 0
  fi
  local parent
  parent="$(dirname "$path")"
  [[ -d "$parent" ]] && [[ -w "$parent" ]]
}

_resolve_and_create_host_data_dir() {
  local path="$1" parent resolved

  if [[ "$path" != /* ]]; then
    resolved="$(cd "${ROOT_DIR}" && mkdir -p "$path" && cd "$path" && pwd)" || true
    if [[ -n "${resolved:-}" ]]; then
      echo "$resolved"
      return 0
    fi
    fail "Could not create storage folder: ${ROOT_DIR}/${path}"
  fi

  if [[ -d "$path" ]]; then
    if [[ ! -w "$path" ]]; then
      fail "Storage folder exists but is not writable: ${path}"
    fi
    cd "$path" && pwd
    return 0
  fi

  parent="$(dirname "$path")"
  if [[ ! -d "$parent" ]]; then
    fail "Parent folder does not exist: ${parent} (create the mount first, or pick another path)"
  fi

  if mkdir -p "$path" 2>/dev/null; then
    cd "$path" && pwd
    return 0
  fi

  if command -v sudo &>/dev/null; then
    warn "Permission denied creating ${path}"
    read -r -p "  Create it with sudo and give ownership to $(id -un)? [y/N]: " use_sudo
    if [[ "$use_sudo" =~ ^[Yy] ]]; then
      if sudo mkdir -p "$path" && sudo chown -R "$(id -u):$(id -g)" "$path"; then
        ok "Created ${path}"
        cd "$path" && pwd
        return 0
      fi
    fi
  fi

  echo ""
  fail "Cannot create ${path} (permission denied).
  Use a folder you own, for example:
    ${ROOT_DIR}/data/arciin
    /media/<user>/<drive>/arciin-data   (USB / external disk)
  Or run: sudo mkdir -p ${path} && sudo chown -R $(id -un):$(id -gn) ${path}"
}

_list_storage_candidates() {
  local path
  for path in \
    "${ROOT_DIR}/data/arciin" \
    /mnt/*/arciin-data \
    /media/*/*/arciin-data; do
    [[ "$path" == *"*"* ]] && continue
    _can_use_storage_path "$path" && echo "$path"
  done
  if [[ -d /srv ]] && [[ -w /srv ]]; then
    _can_use_storage_path "/srv/arciin" && echo "/srv/arciin"
  fi
}

_storage_choice_label() {
  local path="$1"
  if [[ "$path" == "${ROOT_DIR}/data/arciin" ]]; then
    echo " ${DIM}(in project — always works)${RESET}"
  elif [[ "$path" == /media/* ]]; then
    echo " ${DIM}(external drive — good for large media libraries)${RESET}"
  elif [[ "$path" == /mnt/* ]]; then
    echo " ${DIM}(mounted drive)${RESET}"
  fi
}

_ensure_env_kv() {
  local env_file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    echo "${key}=${value}" >>"$env_file"
  fi
}

_prepare_host_data_dir() {
  local host_dir="$1"
  if ! mkdir -p "${host_dir}/objects" "${host_dir}/libraries" "${host_dir}/thumbnails" \
    "${host_dir}/temp" "${host_dir}/logs" "${host_dir}/avatars" 2>/dev/null; then
    if command -v sudo &>/dev/null; then
      sudo mkdir -p "${host_dir}/objects" "${host_dir}/libraries" "${host_dir}/thumbnails" \
        "${host_dir}/temp" "${host_dir}/logs" "${host_dir}/avatars"
      sudo chown -R "$(id -u):$(id -g)" "$host_dir"
    else
      fail "Could not create subfolders under ${host_dir}"
    fi
  fi

  # node:20-alpine runs as uid 1000 — container must write uploads here
  if [[ "$(stat -c '%u' "$host_dir" 2>/dev/null || echo 0)" != "1000" ]]; then
    if command -v sudo &>/dev/null && [[ "$(id -u)" -ne 1000 ]]; then
      warn "Granting Docker (uid 1000) write access to ${host_dir}"
      sudo chown -R 1000:1000 "$host_dir" 2>/dev/null \
        || warn "If uploads fail: sudo chown -R 1000:1000 ${host_dir}"
    fi
  fi
  ok "Storage directory: ${host_dir}"
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

# ── Storage path ────────────────────────────────────────────────────────────
HOST_DATA="${ARCIIN_HOST_DATA_DIR:-}"

if [[ -z "$HOST_DATA" ]] && [[ -t 0 ]]; then
  echo -e "  ${BOLD}Where should Arciin store your files?${RESET}"
  echo -e "  ${DIM}This path is on your real drive (bind mount), not inside the container.${RESET}"
  echo ""
  mapfile -t CANDIDATES < <(_list_storage_candidates | awk '!seen[$0]++' | head -8)
  if [[ "${#CANDIDATES[@]}" -eq 0 ]]; then
    CANDIDATES=("${ROOT_DIR}/data/arciin")
  fi
  n=1
  for c in "${CANDIDATES[@]}"; do
    echo -e "    ${n}) ${c}$(_storage_choice_label "$c")"
    n=$((n + 1))
  done
  echo -e "    ${n}) Enter a custom path"
  echo ""
  read -r -p "  Choice [1]: " choice
  choice="${choice:-1}"
  if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "${#CANDIDATES[@]}" ]]; then
    HOST_DATA="${CANDIDATES[$((choice - 1))]}"
  else
    read -r -p "  Full path: " HOST_DATA
    [[ -n "$HOST_DATA" ]] || fail "Storage path is required"
  fi
elif [[ -z "$HOST_DATA" ]]; then
  HOST_DATA="${ROOT_DIR}/data/arciin"
fi

HOST_DATA="$(_resolve_and_create_host_data_dir "$HOST_DATA")"

_prepare_host_data_dir "$HOST_DATA"

# ── .env ────────────────────────────────────────────────────────────────────
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

# ── Build & start ─────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Starting Docker stack…${RESET}"
echo -e "  ${DIM}${COMPOSE} up --build -d${RESET}"
echo ""

export ARCIIN_HOST_DATA_DIR="$HOST_DATA"
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
