#!/usr/bin/env bash
# Native-install PostgreSQL credential helpers (ARC-009).
# Sourced by install.sh and isolated installer tests. Do not execute directly.

# Generate a URL-safe, SQL-safe password (hex). Never print the value.
arciin_generate_db_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return 0
  fi
  if [[ -r /dev/urandom ]]; then
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
    return 0
  fi
  return 1
}

# Percent-encode for the password field of a PostgreSQL URL.
arciin_urlencode_db_password() {
  local raw="$1"
  python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$raw" 2>/dev/null && return 0
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$raw" 2>/dev/null && return 0
  # Hex-only fallback: generated passwords are already [0-9a-f].
  if [[ "$raw" =~ ^[0-9a-fA-F._~-]+$ ]]; then
    printf '%s' "$raw"
    return 0
  fi
  return 1
}

# Decode a URL-encoded password (for connecting / CREATE ROLE).
arciin_urldecode_db_password() {
  local raw="$1"
  python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$raw" 2>/dev/null && return 0
  node -e 'process.stdout.write(decodeURIComponent(process.argv[1]))' "$raw" 2>/dev/null && return 0
  printf '%s' "$raw"
}

# Extract user, password, host, port, db from a postgresql:// URL.
# Prints: user<TAB>password<TAB>host<TAB>port<TAB>db  (password is still URL-encoded)
arciin_parse_database_url() {
  local url="$1"
  python3 - <<'PY' "$url" 2>/dev/null && return 0
import sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1])
if u.scheme not in ("postgres", "postgresql"):
    sys.exit(1)
user = u.username or ""
password = u.password or ""
host = u.hostname or "localhost"
port = str(u.port or 5432)
db = (u.path or "/").lstrip("/") or "arciin"
print(f"{user}\t{password}\t{host}\t{port}\t{db}")
PY
  node - <<'JS' "$url" 2>/dev/null
const u = new URL(process.argv[1])
if (!/^postgres/.test(u.protocol)) process.exit(1)
const db = u.pathname.replace(/^\//, "") || "arciin"
process.stdout.write(`${u.username || ""}\t${u.password || ""}\t${u.hostname || "localhost"}\t${u.port || "5432"}\t${db}\n`)
JS
}

arciin_format_database_url() {
  local user="$1" encoded_password="$2" host="$3" port="$4" db="$5"
  printf 'postgresql://%s:%s@%s:%s/%s' "$user" "$encoded_password" "$host" "$port" "$db"
}

# Read DATABASE_URL= from an env file without sourcing it.
arciin_read_env_database_url() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 1
  grep -E '^DATABASE_URL=' "$env_file" | head -1 | sed 's/^DATABASE_URL=//' | sed 's/^"//; s/"$//'
}

# Fresh install: generate. Existing env with a password: preserve.
# Prints the resolved *raw* (decoded) password on stdout. Never logs it.
#
# Args: env_file fresh_flag(0|1)
# Exit 2 if no safe credential can be resolved.
arciin_resolve_db_password() {
  local env_file="$1"
  local fresh="${2:-0}"
  local url encoded raw

  url="$(arciin_read_env_database_url "$env_file" 2>/dev/null || true)"
  if [[ -n "$url" ]]; then
    encoded="$(arciin_parse_database_url "$url" | awk -F'\t' '{print $2}')"
    raw="$(arciin_urldecode_db_password "$encoded")"
  fi

  if [[ "$fresh" == "1" ]]; then
    # Placeholder copied from .env.example is not a real install credential.
    if [[ -z "$raw" || "$raw" == "arciin" || "$raw" == "change-me" ]]; then
      raw="$(arciin_generate_db_password)" || return 2
      printf '%s' "$raw"
      return 0
    fi
  fi

  if [[ -z "$raw" ]]; then
    return 2
  fi
  printf '%s' "$raw"
}

arciin_restrict_env_perms() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  chmod 600 "$env_file" 2>/dev/null || true
}

# True if haystack contains the secret (for installer log tests).
arciin_log_leaks_secret() {
  local haystack="$1"
  local secret="$2"
  [[ -n "$secret" && "$haystack" == *"$secret"* ]]
}
