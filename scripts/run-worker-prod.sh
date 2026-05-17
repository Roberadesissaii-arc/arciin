#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec "$ROOT/node_modules/.bin/tsx" --tsconfig "$ROOT/apps/worker/tsconfig.json" "$ROOT/apps/worker/src/index.ts"
