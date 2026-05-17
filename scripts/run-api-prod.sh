#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec "$ROOT/node_modules/.bin/tsx" --tsconfig "$ROOT/apps/api/tsconfig.json" "$ROOT/apps/api/src/index.ts"
