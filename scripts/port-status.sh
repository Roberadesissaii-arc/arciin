#!/usr/bin/env bash
# Show what is listening on Arciin web/API port ranges.
set -euo pipefail

echo "=== Web ports 3000–3010 ==="
for p in $(seq 3000 3010); do
  line="$(ss -tlnpH "sport = :${p}" 2>/dev/null || true)"
  if [[ -n "$line" ]]; then
    printf "  %s  %s\n" "$p" "$line"
  fi
done

echo ""
echo "=== API ports 4000–4010 ==="
for p in $(seq 4000 4010); do
  line="$(ss -tlnpH "sport = :${p}" 2>/dev/null || true)"
  if [[ -n "$line" ]]; then
    printf "  %s  %s\n" "$p" "$line"
  fi
done

echo ""
if [[ -f .env ]]; then
  echo "=== Arciin .env ==="
  grep -E '^(PORT|API_PORT|ARCIIN_PUBLIC_URL|ARCIIN_API_URL)=' .env 2>/dev/null | sed 's/^/  /' || true
fi

echo ""
echo "=== PM2 ==="
pm2 list 2>/dev/null || echo "  pm2 not running"
