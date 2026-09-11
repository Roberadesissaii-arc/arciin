#!/usr/bin/env bash
set -euo pipefail

cd /app

echo "[arciin-api] Bootstrapping database and storage..."
bash scripts/arciin-init.sh

echo "[arciin-api] Starting API server..."
exec node apps/api/dist/index.js
