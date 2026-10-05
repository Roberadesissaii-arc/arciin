#!/usr/bin/env bash
#
#   Arciin — canonical Docker installer (v1.1.4)
#
#   Every Docker install path runs this script:
#     curl -fsSL https://get.arciin.com/install.sh | bash   (downloads it from the release)
#     ./install.sh --docker                                  (from a checkout)
#     ./scripts/docker-setup.sh                              (from a checkout)
#
#   It installs the published images pinned by version AND digest from the
#   release manifest (stable.json), using docker-compose.production.yml as
#   the only production Compose definition.
#
#   Usage:
#     docker-install.sh                 install, or repair/upgrade in place
#     docker-install.sh --repair        same, but never starts from nothing
#     docker-install.sh --fresh         ERASE the Arciin database (typed confirmation)
#     docker-install.sh --uninstall     stop and remove containers; keep data
#         [--delete-data]               … and ERASE the database volumes (typed)
#         [--delete-storage]            … and DELETE uploaded files (typed)
#     docker-install.sh --status        print the detected state and exit
#
#   Options:
#     --dir DIR             config directory          (ARCIIN_DIR, default /opt/arciin)
#     --data-dir DIR        where your files live     (ARCIIN_HOST_DATA_DIR)
#     --port PORT           host HTTP port            (ARCIIN_HTTP_PORT, default 80)
#     --version X.Y.Z       install this release      (ARCIIN_VERSION, default: latest stable)
#     --local-assets DIR    use compose + Caddyfile from a checkout instead of the release
#     --allow-root-storage  allow a /mnt or /media path that is not a mounted disk
#     --yes                 never prompt (destructive actions still need ARCIIN_CONFIRM_ERASE)
#
#   Never destructive by default: an existing database is repaired, never
#   re-initialised; a missing or wrong password is recovered, never replaced.
#
set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${ARCIIN_REPO:-Roberadesissaii-arc/arciin}"
PROJECT="${ARCIIN_COMPOSE_PROJECT:-arciin}"
ARCIIN_DIR="${ARCIIN_DIR:-/opt/arciin}"
MODE="install"
DELETE_DATA=0
DELETE_STORAGE=0
ALLOW_ROOT_STORAGE="${ARCIIN_ALLOW_ROOT_STORAGE:-0}"
ASSUME_YES="${ARCIIN_ASSUME_YES:-0}"
LOCAL_ASSETS="${ARCIIN_LOCAL_ASSETS:-}"
WANT_VERSION="${ARCIIN_VERSION:-}"
CLI_DATA_DIR="${ARCIIN_HOST_DATA_DIR:-}"
CLI_PORT="${ARCIIN_HTTP_PORT:-}"
EXPECTED_SERVICES=6

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repair) MODE=repair ;;
    --fresh|--reset-db) MODE=fresh ;;
    --uninstall) MODE=uninstall ;;
    --delete-data) DELETE_DATA=1 ;;
    --delete-storage) DELETE_STORAGE=1 ;;
    --status) MODE=status ;;
    --dir) ARCIIN_DIR="$2"; shift ;;
    --data-dir) CLI_DATA_DIR="$2"; shift ;;
    --port) CLI_PORT="$2"; shift ;;
    --version) WANT_VERSION="${2#v}"; shift ;;
    --local-assets) LOCAL_ASSETS="$2"; shift ;;
    --allow-root-storage) ALLOW_ROOT_STORAGE=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '3,33p' "${BASH_SOURCE[0]}" | sed 's/^#\s\{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# The state library sits next to this script in a checkout (lib/) and in a
# release download (same directory).
for candidate in "$SELF_DIR/lib/install-state.sh" "$SELF_DIR/install-state.sh"; do
  if [[ -f "$candidate" ]]; then
    # shellcheck source=scripts/lib/install-state.sh
    source "$candidate"
    break
  fi
done
command -v arciin_classify_docker >/dev/null 2>&1 || {
  echo "install-state.sh not found next to docker-install.sh — re-download the installer." >&2
  exit 1
}

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; ORANGE=$'\033[38;5;208m'
else
  BOLD=""; DIM=""; RESET=""; GREEN=""; YELLOW=""; ORANGE=""
fi

step() { printf '\n  %s▸%s %s%s%s\n' "$ORANGE" "$RESET" "$BOLD" "$1" "$RESET"; }
ok()   { printf '    %s✔%s %s\n' "$GREEN" "$RESET" "$1"; }
info() { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }

HAS_TTY=0
if [[ -r /dev/tty ]] && { : </dev/tty; } 2>/dev/null; then HAS_TTY=1; fi

ask() { # ask "prompt" default -> echoes the answer (default when no tty)
  local reply=""
  if [[ "$ASSUME_YES" == "1" || "$HAS_TTY" != "1" ]]; then echo "$2"; return; fi
  printf '    %s ' "$1" >/dev/tty
  read -r reply </dev/tty || reply=""
  echo "${reply:-$2}"
}

confirm() { # confirm "question" -> 0 yes / 1 no (no tty → no)
  [[ "$ASSUME_YES" == "1" ]] && return 0
  [[ "$HAS_TTY" == "1" ]] || return 1
  [[ "$(ask "$1 [y/N]" n)" =~ ^[Yy]$ ]]
}

# Create a directory, escalating only when the parent is not writable.
mkdir_p() { mkdir -p "$@" 2>/dev/null || "${SUDO[@]}" mkdir -p "$@"; }

gen_secret() { openssl rand -hex 32 2>/dev/null || od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }

TMP_FILES=()
cleanup() { local f; for f in "${TMP_FILES[@]}"; do rm -f "$f" 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'arciin_fail_report "The Docker installer stopped unexpectedly (line $LINENO)." \
  "A command failed that the installer did not expect to fail; the message above it is the cause." \
  "Nothing is erased on an unexpected stop. Containers, volumes and files are as they were, or partly updated." \
  "Re-run the installer; it resumes from the detected state" \
  "Diagnose: bash ${ARCIIN_DIR}/arciin-doctor.sh  (or: cd ${ARCIIN_DIR} && docker compose logs --tail 100)"' ERR

secure_tmp() { # secure_tmp -> path of a new mode-600 temp file, removed on exit
  local f
  f="$(mktemp "${TMPDIR:-/tmp}/arciin-install.XXXXXX")"
  chmod 600 "$f"
  TMP_FILES+=("$f")
  echo "$f"
}

env_get() { # env_get KEY [file]
  local file="${2:-$ENV_FILE}"
  [[ -f "$file" ]] || return 0
  grep -E "^$1=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}

env_set() { # env_set KEY VALUE (in $ENV_FILE)
  local key="$1" value="$2" tmp
  tmp="$(secure_tmp)"
  grep -vE "^${key}=" "$ENV_FILE" >"$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  cat "$tmp" >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# ── Host + Docker ────────────────────────────────────────────────────────────
preflight_host() {
  step "Checking this machine"
  [[ "$(uname -s)" == "Linux" ]] || arciin_fail_report \
    "Arciin's Docker install runs on Linux (including WSL2)." \
    "Detected $(uname -s)." "Nothing was changed." "Install on a Linux server or a WSL2 distribution."

  local arch; arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) ok "Architecture ${arch}" ;;
    *) arciin_fail_report "Arciin images are published for x86_64 only." \
         "This machine is ${arch}." "Nothing was changed." \
         "Use an x86_64 server, or the native installer from a checkout (./install.sh)." ;;
  esac
  command -v curl >/dev/null 2>&1 || arciin_fail_report "curl is required." "It is not installed." \
    "Nothing was changed." "sudo apt-get install -y curl, then re-run."

  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=()
  elif command -v sudo >/dev/null 2>&1; then
    SUDO=(sudo)
  else
    arciin_fail_report "This installer needs root privileges for a few steps." \
      "sudo is not installed and you are not root." "Nothing was changed." "Re-run as root, or install sudo."
  fi
}

ensure_docker() {
  step "Checking Docker"
  if ! command -v docker >/dev/null 2>&1; then
    [[ "${ARCIIN_SKIP_DOCKER_INSTALL:-0}" == "1" ]] && arciin_fail_report \
      "Docker is not installed." "ARCIIN_SKIP_DOCKER_INSTALL=1 was set." "Nothing was changed." \
      "Install Docker Engine: https://docs.docker.com/engine/install/"
    warn "Docker is not installed."
    confirm "Install Docker Engine now with Docker's official script (get.docker.com)?" || arciin_fail_report \
      "Docker is required." "You chose not to install it." "Nothing was changed." \
      "curl -fsSL https://get.docker.com | sh   then re-run this installer"
    curl -fsSL https://get.docker.com | "${SUDO[@]}" sh >/dev/null 2>&1 || arciin_fail_report \
      "Docker installation failed." "get.docker.com did not complete." "Nothing of Arciin was changed." \
      "Install Docker manually (https://docs.docker.com/engine/install/) and re-run."
    ok "Docker Engine installed"
    if [[ ${#SUDO[@]} -gt 0 ]]; then
      "${SUDO[@]}" usermod -aG docker "$USER" 2>/dev/null || true
      info "Added $USER to the docker group (takes effect at your next login)."
    fi
  else
    ok "$(docker --version 2>/dev/null | head -1)"
  fi

  DOCKER=(docker)
  if ! docker info >/dev/null 2>&1; then
    if [[ ${#SUDO[@]} -gt 0 ]] && "${SUDO[@]}" docker info >/dev/null 2>&1; then
      DOCKER=("${SUDO[@]}" docker)
      info "Using sudo for Docker this run."
    else
      if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
        arciin_fail_report "Docker is installed, but its engine is not running in WSL." \
          "docker info could not reach the daemon." "Nothing was changed." \
          "Start Docker Desktop on Windows and wait until it says Running" \
          "Docker Desktop → Settings → Resources → WSL integration → enable this distro" \
          "Open a new WSL terminal and re-run the installer"
      fi
      "${SUDO[@]}" systemctl start docker >/dev/null 2>&1 || true
      sleep 2
      if "${SUDO[@]}" docker info >/dev/null 2>&1; then
        DOCKER=("${SUDO[@]}" docker)
      else
        arciin_fail_report "The Docker daemon is not reachable." \
          "$(docker info 2>&1 | tail -1)" "Nothing was changed." \
          "sudo systemctl start docker, then re-run" "Check: sudo journalctl -u docker --since -10min"
      fi
    fi
  fi
  "${DOCKER[@]}" compose version >/dev/null 2>&1 || arciin_fail_report \
    "Docker Compose v2 is not available." "'docker compose' is missing." "Nothing was changed." \
    "Install the docker-compose-plugin package: https://docs.docker.com/compose/install/"
  ok "Docker Compose $("${DOCKER[@]}" compose version --short 2>/dev/null)"

  # Arciin's containers come back after a reboot only if Docker itself starts
  # at boot. Packaged installs enable it; minimal ones sometimes do not.
  DOCKER_BOOT="unknown"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files docker.service >/dev/null 2>&1; then
    if systemctl is-enabled docker.service >/dev/null 2>&1; then
      DOCKER_BOOT="enabled"
    else
      info "Enabling Docker at boot so Arciin restarts after a reboot…"
      if "${SUDO[@]}" systemctl enable docker.service >/dev/null 2>&1; then
        DOCKER_BOOT="enabled"
      else
        DOCKER_BOOT="disabled"
      fi
    fi
  fi
  case "$DOCKER_BOOT" in
    enabled) ok "Docker starts at boot" ;;
    disabled) warn "Docker is not enabled at boot — run: sudo systemctl enable docker" ;;
    *) info "Docker is not managed by systemd here (Docker Desktop / WSL): start it before Arciin." ;;
  esac
}

# DC_ENV is the env file Compose interpolates from: normally .env, a
# placeholder while .env is missing (an existing volume ignores its password).
dc() { "${DOCKER[@]}" compose -p "$PROJECT" --project-directory "$ARCIIN_DIR" -f "$ARCIIN_DIR/docker-compose.yml" --env-file "${DC_ENV:-$ENV_FILE}" "$@"; }

dc_env_or_placeholder() { # sets DC_ENV so Compose can run with or without .env
  if [[ -n "$(env_get POSTGRES_PASSWORD)" ]]; then DC_ENV="$ENV_FILE"; else DC_ENV="$(placeholder_env)"; fi
}

# ── Release manifest ─────────────────────────────────────────────────────────
#
# stable.json is a release asset: flat keys, one per line, so it parses with
# sed on hosts without python or jq. Images are pinned by tag AND digest.
manifest_get() { sed -n "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}[[:space:]]*$/\1/p" "$MANIFEST" | head -1; }

resolve_release() {
  step "Resolving the release"
  MANIFEST="$(secure_tmp)"
  local url
  if [[ -n "${ARCIIN_MANIFEST:-}" ]]; then
    cp "$ARCIIN_MANIFEST" "$MANIFEST"
    url="$ARCIIN_MANIFEST"
  else
    if [[ -n "$WANT_VERSION" ]]; then
      url="https://github.com/${REPO}/releases/download/v${WANT_VERSION}/stable.json"
    else
      url="${ARCIIN_MANIFEST_URL:-https://github.com/${REPO}/releases/latest/download/stable.json}"
    fi
    curl -fsSL --retry 3 "$url" -o "$MANIFEST" 2>/dev/null || arciin_fail_report \
      "Could not download the release manifest." "GET ${url} failed." \
      "Nothing was changed." "Check this server's internet access (HTTPS to github.com)" \
      "Pin a release with --version X.Y.Z"
  fi
  if [[ "$(manifest_get schema)" != "2" ]]; then
    arciin_fail_report "The release manifest is not one this installer understands." \
      "${url} has no schema 2 (releases before v1.1.4 do not publish one)." "Nothing was changed." \
      "Install v1.1.4 or later: --version 1.1.4"
  fi
  RELEASE_VERSION="$(manifest_get version)"
  IMAGE_WEB="$(manifest_get image_web)"
  IMAGE_API="$(manifest_get image_api)"
  IMAGE_WORKER="$(manifest_get image_worker)"
  for ref in "$IMAGE_WEB" "$IMAGE_API" "$IMAGE_WORKER"; do
    [[ "$ref" == *"@sha256:"* || "${ARCIIN_ALLOW_UNPINNED_IMAGES:-0}" == "1" ]] || arciin_fail_report "The release manifest does not pin image digests." \
      "Image reference '${ref}' has no @sha256 digest." "Nothing was changed." \
      "Report this release; install a previous one with --version"
  done
  ok "Arciin ${RELEASE_VERSION} (images pinned by digest)"
}

fetch_assets() {
  step "Fetching the Compose definition"
  mkdir_p "$ARCIIN_DIR"
  [[ -w "$ARCIIN_DIR" ]] || "${SUDO[@]}" chown "$(id -u):$(id -g)" "$ARCIIN_DIR"
  local name src expected actual base
  base="$(manifest_get assets_base)"
  for name in docker-compose.yml Caddyfile docker-install.sh install-state.sh arciin-doctor.sh \
    avahi-discovery.sh open-firewall-ports.sh; do
    local tmp; tmp="$(secure_tmp)"
    if [[ -n "$LOCAL_ASSETS" ]]; then
      case "$name" in
        docker-compose.yml) src="$LOCAL_ASSETS/docker-compose.production.yml" ;;
        Caddyfile) src="$LOCAL_ASSETS/docker/caddy/Caddyfile" ;;
        install-state.sh|avahi-discovery.sh|open-firewall-ports.sh) src="$LOCAL_ASSETS/scripts/lib/$name" ;;
        *) src="$LOCAL_ASSETS/scripts/$name" ;;
      esac
      cp "$src" "$tmp"
    else
      curl -fsSL --retry 3 "${base%/}/${name}" -o "$tmp" 2>/dev/null || arciin_fail_report \
        "Could not download ${name}." "GET ${base%/}/${name} failed." "Nothing was changed." \
        "Check this server's internet access and re-run."
      expected="$(manifest_get "sha256_${name//[.-]/_}")"
      actual="$(sha256sum "$tmp" | awk '{print $1}')"
      [[ -n "$expected" && "$actual" == "$expected" ]] || arciin_fail_report \
        "${name} failed its checksum." "expected ${expected:-<none>}, got ${actual}." \
        "Nothing was changed." "Re-run; if it persists your network is altering downloads."
    fi
    install -m "$([[ "$name" == *.sh ]] && echo 755 || echo 644)" "$tmp" "$ARCIIN_DIR/$name"
  done
  ok "docker-compose.yml, Caddyfile and maintenance scripts in ${ARCIIN_DIR}"
}

# ── State ────────────────────────────────────────────────────────────────────
project_containers() { "${DOCKER[@]}" ps -a --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Names}}' 2>/dev/null || true; }
service_container() { "${DOCKER[@]}" ps -a --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=$1" --format '{{.Names}}' 2>/dev/null | head -1 || true; }
volume_exists() { "${DOCKER[@]}" volume inspect "${PROJECT}_postgres_data" >/dev/null 2>&1; }

# A compose env file good enough to start postgres alone when the real .env
# is missing. The value of POSTGRES_PASSWORD is ignored by an existing volume.
placeholder_env() {
  local f; f="$(secure_tmp)"
  printf '%s\n' "POSTGRES_PASSWORD=placeholder" "REDIS_PASSWORD=placeholder" \
    "ARCIIN_IMAGE_WEB=${IMAGE_WEB}" "ARCIIN_IMAGE_API=${IMAGE_API}" "ARCIIN_IMAGE_WORKER=${IMAGE_WORKER}" >"$f"
  echo "$f"
}

start_postgres() {
  dc up -d --no-deps postgres >/dev/null 2>&1 || return 1
  local i
  for i in $(seq 1 45); do
    if dc exec -T postgres pg_isready -U arciin -d arciin >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# Authenticate over the network, from a separate container, the way the API
# does. Inside the postgres container a socket login is trusted and proves
# nothing. Prints the auth state word.
db_auth() {
  local password="$1" f out code=0
  f="$(secure_tmp)"
  printf 'PGPASSWORD=%s\n' "$password" >"$f"
  out="$("${DOCKER[@]}" run --rm --network "${PROJECT}_default" --env-file "$f" -e PGCONNECT_TIMEOUT=5 \
    postgres:16-alpine psql -X -h postgres -U arciin -d arciin -tAc 'SELECT 1' 2>&1 >/dev/null)" || code=$?
  arciin_classify_db_auth "$code" "$out"
}

detect_state() {
  local total=0 running=0 volume=0 env=0 auth=unknown name
  while read -r name; do
    [[ -n "$name" ]] || continue
    total=$((total + 1))
    [[ "$("${DOCKER[@]}" inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" == "true" ]] && running=$((running + 1))
  done < <(project_containers)
  volume_exists && volume=1
  [[ -n "$(env_get POSTGRES_PASSWORD)" ]] && env=1
  if [[ "$volume" == "1" && "$env" == "1" ]]; then
    if start_postgres; then auth="$(db_auth "$(env_get POSTGRES_PASSWORD)")"; else auth=unreachable; fi
  fi
  DB_AUTH="$auth"
  STATE="$(arciin_classify_docker "$total" "$running" "$EXPECTED_SERVICES" "$volume" "$env" "$auth")"
  arciin_journal_set dockerState "$STATE"
}

# ── Credential recovery ──────────────────────────────────────────────────────
#
# The database volume outlives .env. When they disagree, the fix is never a
# new database: find the password that opens it, or re-key the role.

# Rebuild the original .env from a container's configuration (env_file values
# are recorded there). Prints a temp file path, or nothing.
env_from_container() {
  local name f
  for svc in api worker; do
    name="$(service_container "$svc")"
    [[ -n "$name" ]] || continue
    f="$(secure_tmp)"
    "${DOCKER[@]}" inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$name" 2>/dev/null \
      | grep -E '^[A-Z][A-Z0-9_]*=' \
      | grep -vE '^(PATH|HOME|HOSTNAME|TERM|NODE_VERSION|YARN_VERSION|COREPACK_[A-Z_]*|PNPM_HOME|DATABASE_URL|REDIS_URL|API_PORT)=' >"$f" || true
    if grep -q '^POSTGRES_PASSWORD=.' "$f"; then echo "$f"; return 0; fi
  done
}

env_backups() { # newest first
  local d
  for d in "$ARCIIN_DIR/backups/env" "${DATA_DIR:-}/backups/install"; do
    [[ -d "$d" ]] && ls -1t "$d"/*.env 2>/dev/null || true
  done
}

rekey_database() {
  local password="$1"
  [[ "$password" =~ ^[A-Za-z0-9]+$ ]] || arciin_fail_report "Cannot re-key the database to the password in .env." \
    "POSTGRES_PASSWORD contains characters other than letters and digits, which break the connection URL." \
    "Your data has NOT been changed." "Set POSTGRES_PASSWORD in ${ENV_FILE} to a value of letters and digits (openssl rand -hex 24), then re-run."
  # The image trusts its own local socket, so the role can be re-keyed without
  # the old password. Fed on stdin so it never appears in a process list.
  printf "ALTER ROLE arciin WITH PASSWORD '%s';\n" "$password" \
    | dc exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U arciin -d arciin >/dev/null
}

save_env_backup() {
  [[ -f "$ENV_FILE" ]] || return 0
  local ts; ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$ARCIIN_DIR/backups/env"
  chmod 700 "$ARCIIN_DIR/backups" "$ARCIIN_DIR/backups/env" 2>/dev/null || true
  install -m 600 "$ENV_FILE" "$ARCIIN_DIR/backups/env/${1:-env}-${ts}.env"
  # A second copy on the data disk survives losing ${ARCIIN_DIR} (a reinstalled
  # OS, a deleted folder): the database volume is useless without it.
  if [[ -n "${DATA_DIR:-}" && -d "$DATA_DIR" ]]; then
    mkdir -p "$DATA_DIR/backups/install" 2>/dev/null && chmod 700 "$DATA_DIR/backups/install" 2>/dev/null \
      && install -m 600 "$ENV_FILE" "$DATA_DIR/backups/install/latest.env" 2>/dev/null || true
  fi
  ls -1t "$ARCIIN_DIR/backups/env"/*.env 2>/dev/null | tail -n +11 | xargs -r rm -f
}

recover_credentials() {
  local reason="$1" candidates=() c entry pw found="" src_label="" default choice
  step "Recovering the database credentials"
  if [[ "$reason" == "env_missing" ]]; then
    warn "An Arciin database exists, but ${ENV_FILE} (with its password) is missing."
  else
    warn "The password in ${ENV_FILE} does not open the existing Arciin database."
  fi
  info "Your database has not been changed. Looking for the settings that open it…"

  dc_env_or_placeholder
  start_postgres || arciin_fail_report "PostgreSQL did not start." \
    "The postgres container did not become ready within 90 seconds." "Your data has NOT been changed." \
    "Inspect: cd ${ARCIIN_DIR} && docker compose logs postgres"

  c="$(env_from_container || true)"
  [[ -n "$c" ]] && candidates+=("$c|the existing Arciin containers")
  while read -r c; do [[ -n "$c" ]] && candidates+=("$c|backup $(basename "$c")"); done < <(env_backups)

  for entry in "${candidates[@]}"; do
    pw="$(env_get POSTGRES_PASSWORD "${entry%%|*}")"
    [[ -n "$pw" ]] || continue
    if [[ "$(db_auth "$pw")" == "ok" ]]; then found="${entry%%|*}"; src_label="${entry#*|}"; break; fi
  done

  # Defaults never lose data: restore what works, else (for a wrong password)
  # re-key the role, else cancel.
  if [[ -n "$found" ]]; then default=1
  elif [[ "$reason" == "credential_mismatch" ]]; then default=2
  else default=4; fi

  echo ""
  if [[ -n "$found" ]]; then
    ok "Found settings that open your database: ${src_label}"
    printf '    %s1)%s Restore those settings — keeps everything, including encryption keys\n' "$BOLD" "$RESET"
  fi
  if [[ "$reason" == "env_missing" ]]; then
    printf '    %s2)%s Create new settings and re-key the database user — keeps all data;\n' "$BOLD" "$RESET"
    info "     everyone signs in again and saved integration secrets must be re-entered"
  else
    printf '    %s2)%s Re-key the database user to the password in .env — keeps all data\n' "$BOLD" "$RESET"
  fi
  printf '    %s3)%s Start fresh — ERASE the Arciin database (typed confirmation)\n' "$BOLD" "$RESET"
  printf '    %s4)%s Cancel\n' "$BOLD" "$RESET"
  if [[ "$HAS_TTY" != "1" || "$ASSUME_YES" == "1" ]]; then
    choice="${ARCIIN_CREDENTIAL_RECOVERY:-$default}"
    info "Non-interactive: option ${choice} (set ARCIIN_CREDENTIAL_RECOVERY=1|2|3|4 to choose)"
  else
    choice="$(ask "Choice [${default}]:" "$default")"
  fi

  case "$choice" in
    1)
      [[ -n "$found" ]] || arciin_fail_report "There are no settings to restore." \
        "No container configuration or backup opened the database." "Your data has NOT been changed." \
        "Re-run and choose 2 (re-key) to keep your data"
      [[ -f "$ENV_FILE" ]] && save_env_backup "replaced"
      install -m 600 "$found" "$ENV_FILE"
      ok "Restored settings from ${src_label}"
      ;;
    2)
      if [[ "$reason" == "env_missing" ]]; then
        # write_env builds the full .env around this password.
        NEW_PG_PASSWORD="$(openssl rand -hex 24 2>/dev/null || gen_secret)"
        rekey_database "$NEW_PG_PASSWORD"
      else
        save_env_backup "before-rekey"
        rekey_database "$(env_get POSTGRES_PASSWORD)"
      fi
      ok "Database user re-keyed — all data kept"
      ;;
    3) MODE=fresh; return 0 ;;
    *)
      arciin_fail_report "Install cancelled." "The database credentials were not resolved." \
        "Your data has NOT been changed." "Re-run the installer to choose again" \
        "See docs/REPAIR.md → 'Database password mismatch'"
      ;;
  esac
  pw="${NEW_PG_PASSWORD:-$(env_get POSTGRES_PASSWORD)}"
  [[ "$(db_auth "$pw")" == "ok" ]] || arciin_fail_report \
    "The database still rejects the password." \
    "Recovery did not produce working credentials." "Your data has NOT been deleted." \
    "Re-run the installer and choose 2 (re-key)" "See docs/REPAIR.md"
  ok "Authenticated to the existing database over the network"
  DB_AUTH=ok
}

# ── Destructive paths (all typed) ────────────────────────────────────────────
confirm_erase() {
  echo ""
  printf '    %sThis will remove:%s\n' "$BOLD" "$RESET"
  info "  • the Arciin database (accounts, libraries, file records, settings)"
  info "  • the Redis queue volume"
  info "  • this instance's identity — a paid licence must be moved at https://arciin.com/account"
  printf '    %sNOT deleted:%s your files in %s, and %s\n' "$BOLD" "$RESET" "${DATA_DIR:-the storage folder}" "$ENV_FILE"
  echo ""
  arciin_confirm_typed "ERASE ARCIIN" || arciin_fail_report "Erase cancelled." \
    "The confirmation phrase was not typed exactly." "Your data has NOT been changed." \
    "To keep your data, run the installer without --fresh (repair)."
}

pre_repair_backup() {
  volume_exists || return 0
  start_postgres || true
  local ts dir
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dir="${DATA_DIR}/backups/repair-${ts}"
  mkdir -p "$dir" && chmod 700 "$dir"
  # pg_dump inside the postgres container over its trusted socket: works even
  # while the password is being recovered.
  if dc exec -T postgres pg_dump -U arciin -Fc arciin >"$dir/arciin.dump" 2>/dev/null && [[ -s "$dir/arciin.dump" ]]; then
    [[ -f "$ENV_FILE" ]] && install -m 600 "$ENV_FILE" "$dir/env"
    ok "Database backed up to ${dir} ($(du -h "$dir/arciin.dump" | cut -f1))"
    arciin_journal_set lastBackup "$dir"
  else
    rm -rf "$dir"
    if [[ "$MODE" == "fresh" ]]; then
      confirm "The database could not be backed up. Erase it anyway?" || arciin_fail_report \
        "Erase cancelled." "pg_dump failed, so there would be no way back." "Your data has NOT been changed." \
        "Diagnose: cd ${ARCIIN_DIR} && docker compose logs postgres"
    else
      arciin_fail_report "The pre-upgrade backup failed." "pg_dump could not read the database." \
        "Your data has NOT been changed; nothing was upgraded." \
        "Check free space in ${DATA_DIR}" "Diagnose: cd ${ARCIIN_DIR} && docker compose logs postgres"
    fi
  fi
}

do_uninstall() {
  step "Uninstalling Arciin (Docker)"
  if [[ -f "$ARCIIN_DIR/docker-compose.yml" ]]; then
    dc_env_or_placeholder
    if [[ "$DELETE_DATA" == "1" ]]; then
      confirm_erase
      dc down -v --remove-orphans
      ok "Containers and database volumes removed"
    else
      dc down --remove-orphans
      ok "Containers removed — database volume, files and ${ENV_FILE} kept"
    fi
  else
    local names; names="$(project_containers)"
    # shellcheck disable=SC2086
    if [[ -n "$names" ]]; then "${DOCKER[@]}" rm -f $names >/dev/null; fi
    if [[ "$DELETE_DATA" == "1" ]]; then
      confirm_erase
      "${DOCKER[@]}" volume rm "${PROJECT}_postgres_data" "${PROJECT}_redis_data" >/dev/null 2>&1 || true
    fi
  fi
  if [[ "$DELETE_STORAGE" == "1" ]]; then
    local dir="${DATA_DIR:-}"
    case "$dir" in
      ""|/|/home|/home/*/|/srv|/opt|/var|/mnt|/media|"$HOME"|"$HOME/")
        arciin_fail_report "Refusing to delete '${dir}'." "That is not an Arciin storage folder." \
          "Nothing was deleted." "Delete it by hand if you are sure." ;;
    esac
    [[ -d "$dir/objects" || -d "$dir/libraries" ]] || arciin_fail_report \
      "Refusing to delete '${dir}'." "It does not look like Arciin storage (no objects/ or libraries/)." \
      "Nothing was deleted." "Delete it by hand if you are sure."
    echo ""
    printf '    %sThis permanently deletes every uploaded file in %s%s\n' "$BOLD" "$dir" "$RESET"
    arciin_confirm_typed "DELETE FILES" || arciin_fail_report "File deletion cancelled." \
      "The confirmation phrase was not typed exactly." "Your files have NOT been deleted." "Nothing to do."
    "${SUDO[@]}" rm -rf --one-file-system "$dir"
    ok "Deleted ${dir}"
  fi
  if [[ "$DELETE_DATA" == "1" ]]; then
    save_env_backup "uninstalled"
    rm -f "$ENV_FILE"
    info "Settings backed up to ${ARCIIN_DIR}/backups/env before removal."
  fi
  arciin_journal_set installed "false"
  echo ""
  ok "Arciin is uninstalled."
  [[ "$DELETE_DATA" == "1" ]] || info "Reinstall later with the same command; your data will be picked up."
  exit 0
}

# ── Preflight: ports, resources, storage ─────────────────────────────────────
preflight_port() {
  step "Checking port ${HTTP_PORT}"
  local holder="" ours=""
  ours="$("${DOCKER[@]}" ps --filter "label=com.docker.compose.project=${PROJECT}" --filter "publish=${HTTP_PORT}" --format '{{.Names}}' 2>/dev/null | head -1)"
  if [[ -n "$ours" ]]; then ok "Port ${HTTP_PORT} is held by this Arciin install (${ours})"; return; fi
  if command -v ss >/dev/null 2>&1; then
    holder="$(ss -lntH "sport = :${HTTP_PORT}" 2>/dev/null | head -1 || true)"
    # The owning process is visible only to root; ask sudo without prompting.
    if [[ -n "$holder" ]]; then
      holder="$({ ss -lntpH "sport = :${HTTP_PORT}"; sudo -n ss -lntpH "sport = :${HTTP_PORT}"; } 2>/dev/null | grep users: | head -1 || echo "$holder")"
    fi
  fi
  [[ -z "$holder" ]] && { ok "Port ${HTTP_PORT} is free"; return; }
  local proc container
  proc="$(sed -n 's/.*users:((\"\([^\"]*\)\",pid=\([0-9]*\).*/\1 (pid \2)/p' <<<"$holder")"
  container="$("${DOCKER[@]}" ps --filter "publish=${HTTP_PORT}" --format '{{.Names}}' 2>/dev/null | head -1)"
  arciin_fail_report "Port ${HTTP_PORT} is already in use." \
    "It is held by ${container:+container ${container}}${container:+ / }${proc:-another process}." \
    "Nothing was changed." \
    "Use another port: re-run with --port 8080 (or ARCIIN_HTTP_PORT=8080)" \
    "Or stop the other service, then re-run"
}

preflight_resources() {
  step "Checking resources"
  local root avail_gb mem_mb
  root="$("${DOCKER[@]}" info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  avail_gb="$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print int($4/1024/1024)}')"
  [[ -n "$avail_gb" ]] || avail_gb="$(df -Pk / | awk 'NR==2 {print int($4/1024/1024)}')"
  local need=8
  "${DOCKER[@]}" image inspect "$IMAGE_API" >/dev/null 2>&1 && need=2
  if [[ "$avail_gb" -lt "$need" ]]; then
    arciin_fail_report "Not enough disk space for Docker." \
      "${avail_gb} GB free under ${root}; Arciin's images need about ${need} GB." \
      "Nothing was changed." "Free space (docker system prune removes unused images), then re-run"
  fi
  ok "Disk ${avail_gb} GB free under ${root}"
  mem_mb="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
  if [[ "$mem_mb" -lt 1800 ]]; then
    warn "${mem_mb} MB RAM — Arciin needs about 2 GB; large uploads and imports will be slow."
  else
    ok "Memory ${mem_mb} MB"
  fi
}

prepare_storage() {
  step "Preparing storage"
  if [[ "$ALLOW_ROOT_STORAGE" != "1" && "$(arciin_storage_mount_missing "$DATA_DIR")" == "1" ]]; then
    arciin_fail_report "The storage disk for ${DATA_DIR} is not mounted." \
      "That path is under /mnt or /media but resolves to the system disk; writing there would fill it." \
      "Nothing was changed. Files already on the disk are untouched." \
      "Mount the disk (check /etc/fstab, then: sudo mount -a) and re-run" \
      "Or, to really store files on the system disk: --allow-root-storage"
  fi
  local created=0
  if [[ ! -d "$DATA_DIR" ]]; then
    mkdir_p "$DATA_DIR"
    created=1
  fi
  local d
  for d in objects libraries thumbnails temp logs backups; do
    [[ -d "$DATA_DIR/$d" ]] || mkdir_p "$DATA_DIR/$d"
  done
  local owner; owner="$(stat -c '%u:%g' "$DATA_DIR")"
  if [[ "$owner" != "$PUID:$PGID" ]]; then
    if [[ "$created" == "1" || -z "$(find "$DATA_DIR/objects" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      "${SUDO[@]}" chown -R "$PUID:$PGID" "$DATA_DIR"
    else
      # Never walk an existing library recursively; fix only the top level.
      "${SUDO[@]}" chown "$PUID:$PGID" "$DATA_DIR" "$DATA_DIR"/{objects,libraries,thumbnails,temp,logs,backups}
    fi
  fi
  local as="" writable read_only
  [[ "$PUID" != "$(id -u)" ]] && as="$PUID:$PGID"
  read -r writable read_only < <(arciin_storage_write_test "$DATA_DIR" "$as")
  if [[ "$writable" != "1" ]]; then
    arciin_fail_report "Arciin cannot write to ${DATA_DIR}." \
      "$([[ "$read_only" == 1 ]] && echo "The filesystem is read-only." || echo "uid ${PUID} (the containers' user) has no write access.")" \
      "Nothing was deleted." \
      "sudo chown -R ${PUID}:${PGID} ${DATA_DIR}   then re-run" \
      "For NFS/SMB mounts, map writes to uid ${PUID}"
  fi
  ok "Storage ${DATA_DIR} (writable by uid ${PUID})"
  arciin_journal_set dataDir "$DATA_DIR"
}

# ── Configuration ────────────────────────────────────────────────────────────
write_env() {
  step "Preparing configuration"
  if [[ ! -f "$ENV_FILE" ]]; then
    if volume_exists && [[ -z "${NEW_PG_PASSWORD:-}" ]]; then
      # Guarded upstream; a database must never meet freshly generated credentials.
      arciin_fail_report "Refusing to generate new credentials." \
        "An Arciin database volume exists and ${ENV_FILE} is missing." \
        "Your data has NOT been changed." "Re-run the installer; it will offer recovery"
    fi
    # The LAN address, so phones and other computers can open Arciin; change
    # ARCIIN_PUBLIC_URL in .env for a domain or tunnel.
    local url lan_ip; lan_ip="$(detect_lan_ip)"
    if [[ "$HTTP_PORT" == "80" ]]; then url="http://${lan_ip}"; else url="http://${lan_ip}:${HTTP_PORT}"; fi
    umask 077
    cat >"$ENV_FILE" <<ENV
# Arciin — generated by the installer on $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# Keep this file private: it holds this instance's secrets. A copy is kept in
# ${ARCIIN_DIR}/backups/env and ${DATA_DIR}/backups/install — the database
# cannot be opened without POSTGRES_PASSWORD.
NODE_ENV=production

ARCIIN_HOST_DATA_DIR=${DATA_DIR}
ARCIIN_DATA_DIR=/data/arciin

ARCIIN_SETUP_TOKEN=$(gen_secret)
SESSION_SECRET=$(gen_secret)
ARCIIN_ENCRYPTION_KEY=$(gen_secret)
POSTGRES_PASSWORD=${NEW_PG_PASSWORD:-$(openssl rand -hex 24 2>/dev/null || gen_secret)}
REDIS_PASSWORD=$(openssl rand -hex 24 2>/dev/null || gen_secret)

ARCIIN_PUID=${PUID}
ARCIIN_PGID=${PGID}
ARCIIN_WORKER_CONCURRENCY=2

ARCIIN_HTTP_PORT=${HTTP_PORT}
ARCIIN_PUBLIC_URL=${url}
ARCIIN_API_URL=http://api:4000
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_SOCKET_URL=
NEXT_PUBLIC_ARCIIN_API_ORIGIN=
NEXT_PUBLIC_ARCIIN_PUBLIC_URL=

SESSION_COOKIE_NAME=arciin_session
MAX_UPLOAD_SIZE_MB=20480
UPLOAD_RATE_LIMIT_PER_MINUTE=500
LOG_MAX_FILE_BYTES=1800000

ARCIIN_LICENSE_SERVER_URL=https://license.arciin.com
ENV
    umask 022
    ok "Generated ${ENV_FILE} with new secrets (mode 600)"
    DC_ENV="$ENV_FILE"
  else
    ok "Existing ${ENV_FILE} kept — secrets unchanged"
    local key
    for key in ARCIIN_SETUP_TOKEN SESSION_SECRET ARCIIN_ENCRYPTION_KEY REDIS_PASSWORD; do
      if [[ -z "$(env_get "$key")" || "$(env_get "$key")" =~ ^(change-me|change-this-in-production|dev-token)$ ]]; then
        env_set "$key" "$(gen_secret)"
        info "Filled missing ${key}"
      fi
    done
    [[ -n "$(env_get ARCIIN_PUID)" ]] || { env_set ARCIIN_PUID "$PUID"; env_set ARCIIN_PGID "$PGID"; }
    [[ -n "$(env_get ARCIIN_HOST_DATA_DIR)" ]] || env_set ARCIIN_HOST_DATA_DIR "$DATA_DIR"
    [[ -n "$(env_get ARCIIN_HTTP_PORT)" ]] || env_set ARCIIN_HTTP_PORT "$HTTP_PORT"
  fi
  # Image coordinates always follow the release being installed.
  env_set ARCIIN_IMAGE_WEB "$IMAGE_WEB"
  env_set ARCIIN_IMAGE_API "$IMAGE_API"
  env_set ARCIIN_IMAGE_WORKER "$IMAGE_WORKER"
  env_set ARCIIN_RELEASE_VERSION "$RELEASE_VERSION"
  chmod 600 "$ENV_FILE"
}

# ── LAN access (same as the native installer) ─────────────────────────────────
detect_lan_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i !~ /^127\./ && $i !~ /:/) { print $i; exit }}')"
  [[ -n "$ip" ]] || ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") { print $(i+1); exit }}')"
  echo "${ip:-127.0.0.1}"
}

# Firewall and Avahi (_arciin._tcp) are conveniences: both helpers fail open
# and never stop an install. They ship with the installer as release assets.
host_integration() {
  local lib
  for lib in open-firewall-ports.sh avahi-discovery.sh; do
    for dir in "$SELF_DIR/lib" "$SELF_DIR" "$ARCIIN_DIR"; do
      if [[ -f "$dir/$lib" ]]; then
        # shellcheck source=/dev/null
        source "$dir/$lib"
        break
      fi
    done
  done
  if [[ "${ARCIIN_SKIP_FIREWALL:-0}" != "1" ]] && command -v arciin_open_firewall_ports >/dev/null 2>&1; then
    step "Firewall"
    arciin_open_firewall_ports "$HTTP_PORT" || true
  fi
  if command -v arciin_setup_persistent_mdns >/dev/null 2>&1; then
    step "LAN discovery"
    local http_port="$HTTP_PORT"
    arciin_setup_persistent_mdns "$http_port" || true
  fi
}

# ── Launch + verify ──────────────────────────────────────────────────────────
pull_and_verify() {
  step "Pulling Arciin ${RELEASE_VERSION}"
  info "The first install downloads about 2 GB."
  if [[ "${ARCIIN_ALLOW_UNPINNED_IMAGES:-0}" == "1" ]]; then
    # Test harness only: locally built images have no registry digest.
    warn "ARCIIN_ALLOW_UNPINNED_IMAGES=1 — using local images without digest pinning (testing only)"
    dc pull --quiet --ignore-pull-failures postgres redis caddy >/dev/null 2>&1 || true
  else
    dc pull --quiet || arciin_fail_report "Could not pull the Arciin images." \
    "docker compose pull failed (network, registry or disk)." \
    "Nothing was changed; the running version (if any) keeps running." \
    "Check internet access to ghcr.io and free disk space, then re-run"
  fi
  local ref label
  for ref in "$IMAGE_WEB" "$IMAGE_API" "$IMAGE_WORKER"; do
    label="$("${DOCKER[@]}" image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$ref" 2>/dev/null || true)"
    [[ "${label#v}" == "$RELEASE_VERSION" ]] || arciin_fail_report "Image version mismatch." \
      "${ref%%@*} reports version '${label:-none}', the release is ${RELEASE_VERSION}." \
      "Nothing was changed." "Report this release; install a previous one with --version"
  done
  ok "web, api and worker are ${RELEASE_VERSION} (digests verified by Docker)"
}

launch() {
  step "Starting Arciin"
  dc up -d --remove-orphans >/dev/null || arciin_fail_report "Arciin's containers did not start." \
    "docker compose up failed." "Your data has NOT been deleted." \
    "Logs: cd ${ARCIIN_DIR} && docker compose logs --tail 100" "Diagnose: bash ${ARCIIN_DIR}/arciin-doctor.sh"
  ok "Containers created"
}

wait_healthy() {
  step "Waiting for every service to be healthy"
  local i lines unhealthy=""
  for i in $(seq 1 150); do
    lines="$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null || true)"
    unhealthy="$(awk '$2 != "running" || ($3 != "" && $3 != "healthy")' <<<"$lines")"
    if [[ -n "$lines" && -z "$unhealthy" && "$(wc -l <<<"$lines")" -ge "$EXPECTED_SERVICES" ]]; then
      ok "All ${EXPECTED_SERVICES} services healthy ($((i * 2))s)"
      return 0
    fi
    sleep 2
  done
  local api_logs; api_logs="$(dc logs --tail 60 api 2>/dev/null || true)"
  if grep -q "P1000\|password authentication failed\|cannot authenticate" <<<"$api_logs"; then
    arciin_fail_report "The API cannot log in to PostgreSQL." \
      "The database rejected the password in ${ENV_FILE}." "Your data has NOT been deleted." \
      "Re-run the installer: it detects this and offers recovery" "See docs/REPAIR.md"
  fi
  arciin_fail_report "Arciin did not become healthy within 5 minutes." \
    "Not healthy: $(tr '\n' ';' <<<"$unhealthy")" "Your data has NOT been deleted." \
    "Logs: cd ${ARCIIN_DIR} && docker compose logs --tail 100" "Diagnose: bash ${ARCIIN_DIR}/arciin-doctor.sh"
}

verify_restart_policies() {
  local bad="" name policy
  while read -r name; do
    [[ -n "$name" ]] || continue
    policy="$("${DOCKER[@]}" inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name")"
    [[ "$policy" == "unless-stopped" || "$policy" == "always" ]] || bad+="${name}=${policy:-none} "
  done < <(project_containers)
  [[ -z "$bad" ]] || arciin_fail_report "Some containers will not restart after a reboot." \
    "Restart policy: ${bad}" "Your data has NOT been deleted." \
    "Re-run the installer to replace ${ARCIIN_DIR}/docker-compose.yml with the release copy"
  ok "Restart policy unless-stopped on every container"
}

license_preflight() {
  if dc exec -T api test -f scripts/license-preflight.mjs 2>/dev/null; then
    step "Checking the licensing service"
    dc exec -T api node scripts/license-preflight.mjs || warn "Licensing is unreachable from the API container — activation will fail until it is. Arciin itself works."
  fi
}

summary() {
  local url claimed=""
  url="$(env_get ARCIIN_PUBLIC_URL)"
  claimed="$(curl -fsS --max-time 5 "http://127.0.0.1:${HTTP_PORT}/api/instance/status" 2>/dev/null | grep -o '"initialized":[a-z]*' | cut -d: -f2 || true)"
  echo ""
  printf '  %s%sArciin %s is running.%s\n\n' "$BOLD" "$GREEN" "$RELEASE_VERSION" "$RESET"
  if [[ "$claimed" != "true" ]]; then
    printf '    Open           %s%s/setup%s\n' "$BOLD" "${url%/}" "$RESET"
    printf '    Setup token    %s%s%s\n' "$BOLD" "$(env_get ARCIIN_SETUP_TOKEN)" "$RESET"
    info "The first account becomes the OWNER; setup then locks permanently."
  else
    printf '    Open           %s%s%s\n' "$BOLD" "${url%/}" "$RESET"
  fi
  echo ""
  printf '    Config         %s\n' "$ENV_FILE"
  printf '    Your files     %s\n' "$DATA_DIR"
  printf '    Starts at boot %s\n' "$([[ "$DOCKER_BOOT" == enabled ]] && echo "yes (Docker enabled, restart: unless-stopped)" || echo "only when Docker is started")"
  echo ""
  printf '    %sStatus%s     bash %s/arciin-doctor.sh\n' "$DIM" "$RESET" "$ARCIIN_DIR"
  printf '    %sLogs%s       cd %s && docker compose logs -f\n' "$DIM" "$RESET" "$ARCIIN_DIR"
  printf '    %sUpgrade%s    curl -fsSL https://get.arciin.com/install.sh | bash\n' "$DIM" "$RESET"
  printf '    %sRepair%s     bash %s/docker-install.sh --repair\n' "$DIM" "$RESET" "$ARCIIN_DIR"
  printf '    %sUninstall%s  bash %s/docker-install.sh --uninstall   %s(keeps data)%s\n' "$DIM" "$RESET" "$ARCIIN_DIR" "$DIM" "$RESET"
  printf '    %sLicences%s   https://arciin.com/account\n' "$DIM" "$RESET"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
printf '\n  %s%sArciin%s  %s— your server, your control.%s\n' "$BOLD" "$ORANGE" "$RESET" "$DIM" "$RESET"
printf '  %sDocker install · published images pinned by digest%s\n' "$DIM" "$RESET"

ENV_FILE="$ARCIIN_DIR/.env"
export ARCIIN_JOURNAL="${ARCIIN_JOURNAL:-$ARCIIN_DIR/install-state.json}"

preflight_host
ensure_docker

# Existing settings win over defaults: a re-run must never move the data or port.
DATA_DIR="$(env_get ARCIIN_HOST_DATA_DIR)"
if [[ -n "$CLI_DATA_DIR" && -n "$DATA_DIR" && "$CLI_DATA_DIR" != "$DATA_DIR" ]]; then
  warn "Ignoring --data-dir ${CLI_DATA_DIR}: this install keeps its files in ${DATA_DIR} (edit ${ENV_FILE} to move)."
fi
DATA_DIR="${DATA_DIR:-${CLI_DATA_DIR:-/srv/arciin-storage/arciin}}"
HTTP_PORT="$(env_get ARCIIN_HTTP_PORT)"
HTTP_PORT="${HTTP_PORT:-${CLI_PORT:-80}}"
PUID="$(env_get ARCIIN_PUID)"; PGID="$(env_get ARCIIN_PGID)"
if [[ -z "$PUID" ]]; then
  PUID="${SUDO_UID:-$(id -u)}"; PGID="${SUDO_GID:-$(id -g)}"
  # Containers never run as root; a root-only install maps them to 1000.
  [[ "$PUID" == "0" ]] && { PUID=1000; PGID=1000; }
fi

if [[ "$MODE" == "uninstall" ]]; then
  do_uninstall
fi

resolve_release
fetch_assets
mkdir_p "$(dirname "$ARCIIN_JOURNAL")"
arciin_journal_set mode docker
arciin_journal_set installDir "$ARCIIN_DIR"
arciin_journal_set composeProject "$PROJECT"
arciin_journal_set version "$RELEASE_VERSION"
# An older .env must still interpolate the new Compose file (it requires the
# image variables); these are coordinates, not secrets.
if [[ -f "$ENV_FILE" ]]; then
  env_set ARCIIN_IMAGE_WEB "$IMAGE_WEB"; env_set ARCIIN_IMAGE_API "$IMAGE_API"; env_set ARCIIN_IMAGE_WORKER "$IMAGE_WORKER"
fi
dc_env_or_placeholder

step "Inspecting the existing installation"
detect_state
case "$STATE" in
  none) ok "No existing Arciin — new install" ;;
  stale_containers) warn "Containers from an unfinished install exist with no database — they will be replaced" ;;
  env_missing) warn "Existing database found, but its settings file is missing" ;;
  credential_mismatch) warn "Existing database found, but the configured password does not open it" ;;
  *) ok "Existing Arciin (${STATE}) — upgrading in place; your data is kept" ;;
esac

if [[ "$MODE" == "status" ]]; then
  echo ""; echo "  state=${STATE} dbAuth=${DB_AUTH} version=${RELEASE_VERSION} dir=${ARCIIN_DIR} data=${DATA_DIR}"
  exit 0
fi

if [[ "$MODE" == "repair" && "$STATE" == "none" ]]; then
  arciin_fail_report "There is nothing to repair." "No Arciin containers or database volume were found for project '${PROJECT}'." \
    "Nothing was changed." "Run the installer without --repair to install"
fi

case "$STATE" in
  env_missing|credential_mismatch) [[ "$MODE" == "fresh" ]] || recover_credentials "$STATE" ;;
  stale_containers) dc down --remove-orphans >/dev/null 2>&1 || true ;;
esac

if [[ "$MODE" == "fresh" ]] && volume_exists; then
  step "Fresh install"
  confirm_erase
  pre_repair_backup
  dc down -v --remove-orphans >/dev/null
  ok "Database and queue volumes removed (your files were not touched)"
  arciin_journal_set lastFresh "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  DB_AUTH=unknown
fi

preflight_port
preflight_resources
prepare_storage
write_env
DC_ENV="$ENV_FILE"
if [[ "$MODE" != "fresh" ]] && volume_exists; then
  step "Backing up before the upgrade"
  pre_repair_backup
fi
save_env_backup "install"
pull_and_verify
launch
wait_healthy
verify_restart_policies
host_integration
license_preflight
arciin_journal_step complete
arciin_journal_set installed "true"
summary
