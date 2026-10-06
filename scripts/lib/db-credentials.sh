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

# Placeholders shipped in .env.example are never real credentials.
arciin_is_placeholder_db_password() {
  case "${1:-}" in
    ""|arciin|change-me|changeme|password|postgres) return 0 ;;
  esac
  return 1
}

# Read the decoded password from the DATABASE_URL in <env_file> into the
# variable named <out_var> (empty when there is none), in the current shell.
# Sets ARCIIN_DB_URL_STATE: missing | malformed | placeholder | ok
arciin_db_password_from_env_into() {
  local _e_out_var="$1" _e_env_file="${2:-}" _e_url="" _e_parsed="" _e_encoded="" _e_raw=""
  printf -v "$_e_out_var" '%s' ""
  ARCIIN_DB_URL_STATE="missing"
  _e_url="$(arciin_read_env_database_url "$_e_env_file" 2>/dev/null || true)"
  [[ -n "$_e_url" ]] || return 0
  _e_parsed="$(arciin_parse_database_url "$_e_url" 2>/dev/null || true)"
  _e_encoded="$(printf '%s' "$_e_parsed" | awk -F'\t' '{print $2}')"
  if [[ -z "$_e_parsed" || -z "$_e_encoded" ]]; then
    ARCIIN_DB_URL_STATE="malformed"
    return 0
  fi
  _e_raw="$(arciin_urldecode_db_password "$_e_encoded" 2>/dev/null || true)"
  if arciin_is_placeholder_db_password "$_e_raw"; then
    ARCIIN_DB_URL_STATE="placeholder"
    return 0
  fi
  ARCIIN_DB_URL_STATE="ok"
  printf -v "$_e_out_var" '%s' "$_e_raw"
}

# Resolve the native database password into the variable named <out_var>,
# in the current shell, and record where it came from. Never prints it.
#
#   arciin_resolve_db_password_into <out_var> <env_file> <fresh 0|1> [backup_env_file]
#
# Order: DATABASE_URL in .env → (re-runs only) the installer's .env backup →
# a newly generated password. Sets ARCIIN_DB_PASSWORD_SOURCE:
#   env        .env already held a real password (kept)
#   backup     recovered from the .env backup (repair after .env lost it)
#   generated  fresh install, or nothing usable was found; the installer
#              re-aligns an existing arciin role to it, which changes no data
# ARCIIN_DB_URL_STATE records what .env held: missing|malformed|placeholder|ok.
# Returns 2 only when no password can be generated at all.
#
# Every variable is assigned before it is read: this runs under set -u (the
# installer's `set -Eeuo pipefail`), where an unset local used to abort the
# install with "raw: unbound variable".
arciin_resolve_db_password_into() {
  local _r_out_var="$1" _r_env_file="${2:-}" _r_fresh="${3:-0}" _r_backup="${4:-}"
  local _r_password="" _r_from_backup="" _r_env_state=""
  ARCIIN_DB_PASSWORD_SOURCE=""

  arciin_db_password_from_env_into _r_password "$_r_env_file"
  _r_env_state="$ARCIIN_DB_URL_STATE"
  [[ -n "$_r_password" ]] && ARCIIN_DB_PASSWORD_SOURCE="env"

  if [[ -z "$_r_password" && "$_r_fresh" != "1" && -n "$_r_backup" && -f "$_r_backup" ]]; then
    arciin_db_password_from_env_into _r_from_backup "$_r_backup"
    if [[ -n "$_r_from_backup" ]]; then
      _r_password="$_r_from_backup"
      ARCIIN_DB_PASSWORD_SOURCE="backup"
    fi
  fi
  ARCIIN_DB_URL_STATE="$_r_env_state"

  if [[ -z "$_r_password" ]]; then
    _r_password="$(arciin_generate_db_password 2>/dev/null || true)"
    [[ -n "$_r_password" ]] || return 2
    ARCIIN_DB_PASSWORD_SOURCE="generated"
  fi

  printf -v "$_r_out_var" '%s' "$_r_password"
  return 0
}

# Compatibility wrapper: prints the resolved password (for callers that
# capture it). Prefer arciin_resolve_db_password_into.
arciin_resolve_db_password() {
  local _w_resolved=""
  arciin_resolve_db_password_into _w_resolved "${1:-}" "${2:-0}" "${3:-}" || return 2
  printf '%s' "$_w_resolved"
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
