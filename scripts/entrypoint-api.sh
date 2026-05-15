#!/usr/bin/env bash
set -euo pipefail

cd /app

echo "[arciin-api] Bootstrapping database and storage..."
bash scripts/arciin-init.sh

echo "[arciin-api] Starting API server..."
exec pnpm tsx --tsconfig apps/api/tsconfig.json apps/api/src/index.ts
