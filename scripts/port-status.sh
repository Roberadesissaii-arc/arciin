#!/usr/bin/env bash
# Show what is listening on Arciin ports + firewall hints.
set -euo pipefail

_show_range() {
  local title="$1" start="$2" end="$3"
  echo "=== ${title} ==="
  local p line
  for p in $(seq "$start" "$end"); do
    line="$(ss -tlnpH "sport = :${p}" 2>/dev/null || true)"
    if [[ -n "$line" ]]; then
      printf "  %s  %s\n" "$p" "$line"
    fi
  done
  echo ""
}

_show_range "HTTP / Caddy 80–90" 80 90
_show_range "Web ports 3000–3010 (web + account portal)" 3000 3010
_show_range "API ports 4000–4010" 4000 4010
_show_range "License server 4100–4110" 4100 4110

if [[ -f .env ]]; then
  echo "=== Arciin .env ==="
  grep -E '^(PORT|API_PORT|ARCIIN_WEB_PORT|ARCIIN_HTTP_PORT|ARCIIN_PUBLIC_URL|ARCIIN_API_URL|LICENSE_SERVER_PORT)=' .env 2>/dev/null | sed 's/^/  /' || true
  echo ""
fi

if command -v ufw >/dev/null 2>&1; then
  echo "=== UFW ==="
  sudo ufw status 2>/dev/null | sed 's/^/  /' || ufw status 2>/dev/null | sed 's/^/  /' || echo "  (could not read ufw)"
  echo ""
fi

echo "=== PM2 ==="
pm2 list 2>/dev/null || echo "  pm2 not running"

echo ""
echo "Re-open firewall ports anytime:  bash scripts/open-firewall.sh"
