#!/usr/bin/env bash
cd "$(dirname "$0")/.."
pm2 start ecosystem.config.cjs 2>/dev/null || pm2 restart arciin-web arciin-api arciin-worker
pm2 save
echo "Arciin started. Logs: pm2 logs"
