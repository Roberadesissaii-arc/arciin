#!/usr/bin/env bash
# Stop Arciin production processes (PM2).
pm2 stop arciin-web arciin-api arciin-worker 2>/dev/null && echo "Arciin stopped." || echo "Arciin is not running."
