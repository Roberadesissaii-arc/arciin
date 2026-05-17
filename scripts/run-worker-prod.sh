#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node node_modules/tsx/dist/cli.mjs --tsconfig apps/worker/tsconfig.json apps/worker/src/index.ts
