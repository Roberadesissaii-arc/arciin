#!/usr/bin/env bash
# Verify native install and production Docker expose the same Arciin contract.
# See docs/INSTALL-PARITY.md for the contract and intentional differences.
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
echo "Contract: docs/INSTALL-PARITY.md"
echo ""

check "docker-compose.production.yml exists" "test -f docker-compose.production.yml"
check "docs/INSTALL-PARITY.md exists" "test -f docs/INSTALL-PARITY.md"
check "install.sh exists" "test -f install.sh"
check "Shared init: arciin-init.sh" "test -f scripts/arciin-init.sh"
check "Docker API entrypoint runs init" "grep -q arciin-init scripts/entrypoint-api.sh"
check "Native install runs init" "grep -q arciin-init.sh install.sh"
check "Worker healthcheck script" "test -f scripts/worker-healthcheck.mjs"
check "Production compose is the contract (not development compose)" \
  "grep -q 'docker-compose.production.yml' scripts/verify-install-parity.sh"

echo ""
echo "Semantic production/native contract"
echo ""

if node scripts/lib/install-parity.mjs "$ROOT"; then
  echo -e "  ${GREEN}✔${RESET}  production/native contract"
else
  echo -e "  ${RED}✖${RESET}  production/native contract"
  fail=1
fi

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  if [[ -f .env.docker.example ]]; then
    if docker compose -f docker-compose.production.yml --env-file .env.docker.example config -q >/dev/null 2>&1; then
      echo -e "  ${GREEN}✔${RESET}  docker compose -f docker-compose.production.yml config"
    else
      echo -e "  ${YELLOW}○${RESET}  docker compose production config (env placeholders may be required)"
    fi
  fi
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
