#!/usr/bin/env bash
# Print URLs to use when Arciin runs in WSL and scripts run on Windows or another LAN machine.
set -euo pipefail

WSL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"

echo "Arciin WSL network hints"
echo "========================"
echo ""
echo "WSL IP (use from Windows Python / other devices on LAN):"
echo "  ${WSL_IP:-<unknown>}"
echo ""
echo "API (uploads, health, Python socket script):"
echo "  http://${WSL_IP:-127.0.0.1}:${API_PORT}/api"
echo ""
echo "Web UI (browser on Windows host — usually works):"
echo "  http://localhost:${WEB_PORT}"
echo ""
echo "Python examples (edit scripts/examples/arciin_example_client.py):"
echo "  API_BASE = \"http://${WSL_IP:-172.22.212.155}:${API_PORT}/api\""
echo "  SOCKET_URL = \"http://${WSL_IP:-172.22.212.155}:${API_PORT}\""
echo "  See scripts/examples/README.md"
echo ""
echo "Test API:"
if [[ -n "${WSL_IP}" ]]; then
  curl -fsS -m 3 "http://127.0.0.1:${API_PORT}/api/health" && echo "  (127.0.0.1:${API_PORT} OK from WSL)" || echo "  API not responding on 127.0.0.1:${API_PORT} — run: pnpm dev"
fi
