#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_NODE_MAJOR=24
DEFAULT_PNPM_VERSION=10.32.1
DEFAULT_MIGRATION_NAME="arciin-bootstrap"

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

if command -v psql >/dev/null 2>&1; then
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
fi

cd "${ROOT_DIR}"

log "Installing JavaScript dependencies"
pnpm install

log "Generating Prisma client"
pnpm db:generate

if [[ "${ARCIIN_RUN_MIGRATIONS:-0}" == "1" ]]; then
  MIGRATION_NAME="${ARCIIN_MIGRATION_NAME:-${DEFAULT_MIGRATION_NAME}}"
  log "Running database migrations"
  pnpm exec prisma migrate dev --name "${MIGRATION_NAME}"
else
  log "Skipping database migrations. Set ARCIIN_RUN_MIGRATIONS=1 to run them automatically."
fi

cat <<'EOF'

[arciin-install] Setup complete.

Next steps:
  1. Review .env and adjust DATABASE_URL / REDIS_URL if you use non-default services.
  2. Run: pnpm db:migrate
  3. Start the app: pnpm dev

Optional:
  ARCIIN_UPGRADE_SYSTEM=1 ./install.sh
  ARCIIN_RUN_MIGRATIONS=1 ./install.sh
  ARCIIN_MIGRATION_NAME=my-local-change ARCIIN_RUN_MIGRATIONS=1 ./install.sh

Health checks:
  redis-cli ping
  pg_isready -h localhost -p 5432

Notes:
  This installer is intended for local development on Debian/Ubuntu/WSL.
  Production/self-hosted installs should use Docker Compose later.
EOF
