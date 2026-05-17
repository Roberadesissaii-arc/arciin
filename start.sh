#!/usr/bin/env bash
# Start Arciin production processes (PM2).
cd "$(dirname "$0")"
mkdir -p logs
if pm2 describe arciin-web &>/dev/null; then
  pm2 restart arciin-web arciin-api arciin-worker
else
  pm2 start ecosystem.config.cjs
fi
pm2 save
echo "Arciin started."
echo "  pm2 status"
echo "  pm2 logs arciin-web"
