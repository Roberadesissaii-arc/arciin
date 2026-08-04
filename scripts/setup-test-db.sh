#!/usr/bin/env bash
# Create/refresh the isolated integration-test database.
#
# Derives connection details from .env and only ever swaps in the
# `arciin_test` database name — it never touches the production database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TEST_DB_NAME="arciin_test"

PROD_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"
if [[ -z "$PROD_URL" ]]; then
  echo "DATABASE_URL not found in .env" >&2
  exit 1
fi

TEST_URL="$(python3 - "$PROD_URL" "$TEST_DB_NAME" <<'PY'
import sys
from urllib.parse import urlparse, urlunparse
url, name = sys.argv[1], sys.argv[2]
print(urlunparse(urlparse(url)._replace(path=f"/{name}")))
PY
)"

case "$TEST_URL" in
  */"$TEST_DB_NAME") ;;
  *) echo "Refusing: derived URL is not the test database." >&2; exit 1 ;;
esac

echo "Ensuring database ${TEST_DB_NAME} exists…"
psql "$PROD_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB_NAME}'" \
  | grep -q 1 || psql "$PROD_URL" -c "CREATE DATABASE ${TEST_DB_NAME}"

echo "Pushing schema…"
DATABASE_URL="$TEST_URL" npx prisma db push --skip-generate --accept-data-loss

echo "Ready. Run: pnpm test:integration"
