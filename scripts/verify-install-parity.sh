#!/usr/bin/env bash
# Verify Docker and native install paths expose the same Arciin stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'
fail=0

check() {
  if eval "$2" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✔${RESET}  $1"
  else
    echo -e "  ${RED}✖${RESET}  $1"
    fail=1
  fi
}

echo ""
echo "Arciin install parity checks"
echo ""

check "docker-compose.yml exists" "test -f docker-compose.yml"
check "Compose defines web, api, worker, postgres, redis, caddy" \
  "grep -qE '^  (web|api|worker|postgres|redis|caddy):' docker-compose.yml"
check "install.sh supports --docker" "grep -q -- '--docker' install.sh"
check "docker-setup.sh exists" "test -f scripts/docker-setup.sh"
check "Shared init: arciin-init.sh" "test -f scripts/arciin-init.sh"
check "Docker API entrypoint runs init" "grep -q arciin-init scripts/entrypoint-api.sh"
check "Native install runs init" "grep -q arciin-init.sh install.sh"
check ".env.example present" "test -f .env.example"
check ".env.docker.example present" "test -f .env.docker.example"
check "Dockerfiles: web, api, worker" \
  "test -f Dockerfile.web && test -f Dockerfile.api && test -f Dockerfile.worker"

for key in ARCIIN_SETUP_TOKEN SESSION_SECRET MAX_UPLOAD_SIZE_MB UPLOAD_RATE_LIMIT_PER_MINUTE LOG_MAX_FILE_BYTES; do
  check ".env.example has ${key}" "grep -q '^${key}=' .env.example"
  check ".env.docker.example has ${key}" "grep -q '^${key}=' .env.docker.example"
done

check "docs/DOCKER.md exists" "test -f docs/DOCKER.md"

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  check "docker compose config validates" "docker compose --env-file .env.docker.example config -q"
else
  echo -e "  ${YELLOW}○${RESET}  docker compose config (skipped — Docker not available)"
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo -e "${GREEN}All parity checks passed.${RESET}"
  exit 0
fi
echo -e "${RED}Some checks failed.${RESET}"
exit 1
