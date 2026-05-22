#!/usr/bin/env bash
# Quick report when the UI loads but /api returns 502 (Caddy up, API down).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'

if ! command -v docker &>/dev/null; then
  echo "docker not found"
  exit 1
fi

echo ""
echo "Arciin Docker doctor"
echo "===================="
echo ""

docker compose ps 2>/dev/null || docker-compose ps 2>/dev/null || true

echo ""
echo "── API logs (last 40 lines) ──"
docker compose logs api --tail 40 2>/dev/null || true

echo ""
echo "── Worker logs (last 15 lines) ──"
docker compose logs worker --tail 15 2>/dev/null || true

echo ""
echo "── Local probes (from this host) ──"
for url in "http://127.0.0.1/api/health" "http://127.0.0.1/"; do
  code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 3 "$url" 2>/dev/null || echo "000")"
  if [[ "$code" == "200" ]]; then
    echo -e "  ${GREEN}✔${RESET}  $url → $code"
  else
    echo -e "  ${RED}✖${RESET}  $url → $code"
  fi
done

api_status="$(docker compose ps api --format '{{.Status}}' 2>/dev/null | head -1 || true)"
if [[ -z "$api_status" ]]; then
  echo -e "\n${RED}api service not listed — run: docker compose up -d${RESET}"
elif [[ "$api_status" != *"Up"* && "$api_status" != *"running"* ]]; then
  echo -e "\n${RED}api is not running.${RESET} Try:"
  echo "  docker compose up --build -d api worker"
elif curl -sS -o /dev/null -w "" --connect-timeout 3 http://127.0.0.1/api/health 2>/dev/null; then
  echo -e "\n${GREEN}API health OK.${RESET}"
else
  echo -e "\n${YELLOW}api container exists but /api/health failed.${RESET} Try:"
  echo "  docker compose logs api --tail 100"
  echo "  docker compose up --build -d api"
fi

echo ""
