#!/usr/bin/env bash
# Create/refresh the isolated development database (arciin_dev).
# Derives connection details from .env.development; never touches production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.development ]]; then
  echo ".env.development not found — development isolation is not configured." >&2
  exit 1
fi

DEV_URL="$(grep -E '^DATABASE_URL=' .env.development | cut -d= -f2- | tr -d '"')"
PROD_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"

DEV_NAME="$(python3 -c "
import sys
from urllib.parse import urlparse
print(urlparse('$DEV_URL').path.lstrip('/'))
")"
PROD_NAME="$(python3 -c "
import sys
from urllib.parse import urlparse
print(urlparse('$PROD_URL').path.lstrip('/'))
")"

if [[ -z "$DEV_NAME" || "$DEV_NAME" == "$PROD_NAME" ]]; then
  echo "Refusing: development database resolves to the production database ($PROD_NAME)." >&2
  exit 1
fi

echo "Ensuring database ${DEV_NAME} exists…"
psql "$PROD_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='${DEV_NAME}'" \
  | grep -q 1 || psql "$PROD_URL" -c "CREATE DATABASE ${DEV_NAME}"

echo "Pushing schema to ${DEV_NAME}…"
DATABASE_URL="$DEV_URL" npx prisma db push --skip-generate --accept-data-loss

echo "Ready. Start development with: pnpm dev"
