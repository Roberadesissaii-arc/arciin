#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_NODE_MAJOR=24
DEFAULT_PNPM_VERSION=10.32.1

log() {
  printf '\n[arciin-install] %s\n' "$1"
}

warn() {
  printf '\n[arciin-install] warning: %s\n' "$1" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    warn "Missing required command: $1"
    exit 1
  fi
}

start_service() {
  local service_name="$1"

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files >/dev/null 2>&1; then
    sudo systemctl enable --now "$service_name" || warn "Could not enable/start ${service_name}"
  else
    sudo service "$service_name" start || warn "Could not start ${service_name}"
  fi
}

ensure_postgres_role_and_db() {
  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found; skipping local PostgreSQL role/database setup"
    return 0
  fi

  log "Ensuring default local PostgreSQL role and database exist"
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='arciin'" | grep -q 1; then
    sudo -u postgres psql -c "ALTER ROLE arciin WITH LOGIN PASSWORD 'arciin' CREATEDB;"
  else
    sudo -u postgres psql -c "CREATE ROLE arciin WITH LOGIN PASSWORD 'arciin' CREATEDB;"
  fi

  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='arciin'" | grep -q 1; then
    sudo -u postgres psql -c "ALTER DATABASE arciin OWNER TO arciin;"
  else
    sudo -u postgres psql -c "CREATE DATABASE arciin OWNER arciin;"
  fi

  sudo -u postgres psql -d arciin -c "GRANT ALL ON SCHEMA public TO arciin;" >/dev/null 2>&1 || true
  sudo -u postgres psql -d arciin -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO arciin;" >/dev/null 2>&1 || true
}

ensure_env_file() {
  if [[ ! -f "${ROOT_DIR}/.env" ]]; then
    if [[ ! -f "${ROOT_DIR}/.env.example" ]]; then
      warn ".env.example not found. Cannot create .env automatically."
      exit 1
    fi
    log "Creating .env from .env.example"
    cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  else
    log ".env already exists, leaving it untouched"
  fi
}

ensure_session_secret() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "${env_file}" ]] || return 0

  if grep -q '^SESSION_SECRET=change-this-in-production' "${env_file}" 2>/dev/null; then
    if command -v openssl >/dev/null 2>&1; then
      local secret
      secret="$(openssl rand -base64 32 | tr -d '\n')"
      log "Generating a random SESSION_SECRET in .env"
      sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" "${env_file}"
    else
      warn "openssl not found; update SESSION_SECRET in .env before production use"
    fi
  fi
}

ensure_setup_token() {
  local env_file="${ROOT_DIR}/.env"
  [[ -f "${env_file}" ]] || return 0

  if grep -q '^ARCIIN_SETUP_TOKEN=dev-token' "${env_file}" 2>/dev/null; then
    if command -v openssl >/dev/null 2>&1; then
      local token
      token="$(openssl rand -hex 24)"
      log "Generating a random ARCIIN_SETUP_TOKEN in .env"
      sed -i "s|^ARCIIN_SETUP_TOKEN=.*|ARCIIN_SETUP_TOKEN=${token}|" "${env_file}"
    else
      warn "openssl not found; ARCIIN_SETUP_TOKEN is still 'dev-token' — change it before production use"
    fi
  fi
}

check_ffmpeg() {
  if ! command -v ffmpeg >/dev/null 2>&1; then
    warn "ffmpeg is not available after installation — thumbnail and media probe features will not work"
  else
    log "ffmpeg is available: $(ffmpeg -version 2>&1 | head -1)"
  fi
}

if [[ "${EUID}" -eq 0 ]]; then
  warn "Run this script as your normal user, not as root."
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  warn "This installer currently supports Debian/Ubuntu/WSL environments with apt."
  exit 1
fi

require_command sudo
require_command curl

log "Updating apt package lists"
sudo apt-get update

if [[ "${ARCIIN_UPGRADE_SYSTEM:-0}" == "1" ]]; then
  log "Upgrading installed packages"
  sudo apt-get upgrade -y
else
  log "Skipping full system upgrade. Set ARCIIN_UPGRADE_SYSTEM=1 to enable it."
fi

log "Installing core system dependencies"
sudo apt-get install -y \
  ca-certificates \
  curl \
  ffmpeg \
  git \
  gnupg \
  build-essential \
  unzip \
  python3 \
  openssl \
  libssl-dev \
  pkg-config \
  libatomic1 \
  redis-server \
  postgresql \
  postgresql-contrib

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js ${DEFAULT_NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${DEFAULT_NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "${NODE_MAJOR}" -lt "${DEFAULT_NODE_MAJOR}" ]]; then
    log "Upgrading Node.js to ${DEFAULT_NODE_MAJOR}"
    curl -fsSL "https://deb.nodesource.com/setup_${DEFAULT_NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    log "Node.js is already installed: $(node -v)"
  fi
fi

log "Installing/updating Corepack"
sudo npm install --global corepack@latest

log "Enabling pnpm through Corepack"
corepack enable pnpm
corepack prepare "pnpm@${DEFAULT_PNPM_VERSION}" --activate

ensure_env_file
ensure_session_secret
ensure_setup_token

log "Starting Redis and PostgreSQL"
start_service redis-server
start_service postgresql

if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli ping >/dev/null 2>&1; then
    log "Redis is responding on localhost:6379"
  else
    warn "Redis is installed but not responding on localhost:6379"
  fi
fi

if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    log "PostgreSQL is responding on localhost:5432"
  else
    warn "PostgreSQL is installed but not responding on localhost:5432"
  fi
fi

ensure_postgres_role_and_db

cd "${ROOT_DIR}"

log "Installing JavaScript dependencies"
pnpm install

log "Generating Prisma client"
pnpm db:generate

if [[ "${ARCIIN_SKIP_DB_INIT:-0}" == "1" ]]; then
  warn "Skipping database migrations, seed, and storage dirs (ARCIIN_SKIP_DB_INIT=1)"
else
  bash "${ROOT_DIR}/scripts/arciin-init.sh"
fi

chmod +x "${ROOT_DIR}/scripts/arciin-init.sh" "${ROOT_DIR}/scripts/entrypoint-api.sh" 2>/dev/null || true

check_ffmpeg

SETUP_TOKEN="$(grep '^ARCIIN_SETUP_TOKEN=' "${ROOT_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo 'dev-token')"
PUBLIC_URL="$(grep '^ARCIIN_PUBLIC_URL=' "${ROOT_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo 'http://localhost:3000')"
SETUP_URL="${PUBLIC_URL}/setup?token=${SETUP_TOKEN}"

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Arciin is ready.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. Start the app:
       pnpm dev

  2. Open your setup link (one-time):
       ${SETUP_URL}

     This link contains your setup token. Paste it into the setup form
     to claim the instance and create your admin account.

  Setup token (also in .env):
    ${SETUP_TOKEN}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  What was initialized automatically:
    - PostgreSQL role/database: arciin / arciin
    - All Prisma migrations applied
    - Seed data (default integrations placeholder)
    - Storage directories: objects, libraries, thumbnails, temp, logs
    - Prisma client generated
    - SESSION_SECRET randomized
    - ARCIIN_SETUP_TOKEN randomized

  Health checks:
    redis-cli ping
    pg_isready -h localhost -p 5432

  Optional flags:
    ARCIIN_UPGRADE_SYSTEM=1 ./install.sh   # run apt upgrade first
    ARCIIN_SKIP_DB_INIT=1 ./install.sh     # skip migrate/seed (advanced)

  Docker (alternative):
    cp .env.example .env
    # edit .env: set ARCIIN_SETUP_TOKEN to a random value
    docker compose up --build -d
    # then open: http://localhost/setup?token=<your-token>

  Notes:
    - Intended for Debian/Ubuntu/WSL. Review .env before production use.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
