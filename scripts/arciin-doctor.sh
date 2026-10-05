#!/usr/bin/env bash
# ================================================================
#  arciin doctor — one health report for native (PM2) and Docker installs.
#
#    bash scripts/arciin-doctor.sh            # auto-detect the install mode
#    bash scripts/arciin-doctor.sh --docker   # force Docker (ARCIIN_DIR=/opt/arciin …)
#    bash scripts/arciin-doctor.sh --native
#
#  Read-only: it starts, stops, migrates and deletes nothing. It never prints a
#  password, token, connection string or signing key — only key names, states
#  and non-secret URLs. Exit code: 0 all green, 1 something needs attention.
# ================================================================
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SELF_DIR/.." && pwd)"
# In a checkout the library is scripts/lib/; the Docker installer copies this
# script and the library side by side into ARCIIN_DIR (default /opt/arciin).
if [[ -f "$SELF_DIR/lib/install-state.sh" ]]; then
  # shellcheck source=scripts/lib/install-state.sh
  source "$SELF_DIR/lib/install-state.sh"
else
  # shellcheck source=scripts/lib/install-state.sh
  source "$SELF_DIR/install-state.sh"
  ROOT_DIR="$SELF_DIR"
  export ARCIIN_DIR="${ARCIIN_DIR:-$SELF_DIR}"
fi
# The Docker installer keeps its journal next to its .env.
if [[ -z "${ARCIIN_JOURNAL:-}" && -f "${ARCIIN_DIR:-/opt/arciin}/install-state.json" ]]; then
  export ARCIIN_JOURNAL="${ARCIIN_DIR:-/opt/arciin}/install-state.json"
fi
PROJECT="${ARCIIN_COMPOSE_PROJECT:-$(arciin_journal_get composeProject)}"
PROJECT="${PROJECT:-arciin}"

G="\033[32m"; Y="\033[33m"; R="\033[31m"; B="\033[1m"; D="\033[2m"; X="\033[0m"
PROBLEMS=0
pass() { printf "  ${G}✔${X}  %-24s %s\n" "$1" "$2"; }
warn() { printf "  ${Y}⚠${X}  %-24s %s\n" "$1" "$2"; }
bad()  { printf "  ${R}✖${X}  %-24s %s\n" "$1" "$2"; PROBLEMS=$((PROBLEMS + 1)); }
hint() { printf "     ${D}%s${X}\n" "$1"; }
section() { printf "\n  ${B}%s${X}\n" "$1"; }

MODE=""
for a in "$@"; do
  case "$a" in --docker) MODE=docker ;; --native) MODE=native ;; esac
done

ENV_FILE=""
COMPOSE_DIR=""
COMPOSE_FILE=""
detect_mode() {
  local journal_mode
  journal_mode="$(arciin_journal_get mode)"
  local dir
  for dir in "${ARCIIN_DIR:-}" /opt/arciin "${ROOT_DIR}"; do
    [[ -n "$dir" ]] || continue
    if [[ -f "$dir/docker-compose.yml" && -f "$dir/.env" ]] && grep -q 'name: arciin' "$dir/docker-compose.yml" 2>/dev/null; then
      COMPOSE_DIR="$dir"; COMPOSE_FILE="$dir/docker-compose.yml"; break
    fi
    if [[ -f "$dir/docker-compose.production.yml" && -f "$dir/.env" ]] && [[ "$journal_mode" == "docker" ]]; then
      COMPOSE_DIR="$dir"; COMPOSE_FILE="$dir/docker-compose.production.yml"; break
    fi
  done
  if [[ -z "$MODE" ]]; then
    if [[ "$journal_mode" == "docker" ]] || { [[ -n "$COMPOSE_DIR" ]] && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "${PROJECT}-api-1"; }; then
      MODE=docker
    elif command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q '"name":"arciin-api"'; then
      MODE=native
    elif [[ "$journal_mode" == "native" || -f "${ROOT_DIR}/.env" ]]; then
      MODE=native
    else
      MODE=unknown
    fi
  fi
  if [[ "$MODE" == "docker" ]]; then
    if [[ -z "$COMPOSE_DIR" ]]; then COMPOSE_DIR="${ARCIIN_DIR:-/opt/arciin}"; COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"; fi
    ENV_FILE="$COMPOSE_DIR/.env"
  else
    ENV_FILE="${ROOT_DIR}/.env"
  fi
}

env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'; }

dc() { docker compose -p "$PROJECT" --project-directory "$COMPOSE_DIR" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# ── shared ───────────────────────────────────────────────────────────────────
check_host() {
  section "Host"
  local free_gb mem_mb swap_mb
  free_gb=$(( $(df -Pk "${COMPOSE_DIR:-$ROOT_DIR}" | awk 'NR==2 {print $4}') / 1024 / 1024 ))
  mem_mb=$(( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024 ))
  swap_mb=$(( $(awk '/SwapTotal/ {print $2}' /proc/meminfo) / 1024 ))
  (( free_gb >= 5 )) && pass "Disk" "${free_gb} GB free" || bad "Disk" "${free_gb} GB free — uploads, backups and updates need room"
  (( mem_mb >= 512 )) && pass "Memory" "${mem_mb} MB available, ${swap_mb} MB swap" || warn "Memory" "${mem_mb} MB available — heavy media jobs may fail"
}

check_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then bad "Configuration" "$ENV_FILE missing"; hint "Restore it from a backup, or run the installer with --repair"; return; fi
  local perm missing="" key
  perm="$(stat -L -c '%a' "$ENV_FILE" 2>/dev/null)"
  [[ "$perm" == "600" ]] && pass "Configuration" "$ENV_FILE (mode 600)" || warn "Configuration" "$ENV_FILE is mode ${perm} — run: chmod 600 $ENV_FILE"
  for key in SESSION_SECRET ARCIIN_SETUP_TOKEN; do grep -q "^${key}=." "$ENV_FILE" || missing+=" $key"; done
  [[ -n "$missing" ]] && bad "Secrets" "missing:${missing}" || pass "Secrets" "present (values not shown)"
}

# A public URL that names an IP address this machine no longer has — the DHCP
# lease moved after a reboot — makes links, mobile pairing and QR codes point
# nowhere while everything looks healthy locally.
report_public_url() {
  local url="$1" host
  host="$(sed -E 's#^[a-z]+://([^/:]+).*#\1#' <<<"$url")"
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$host" != 127.* ]] \
     && ! hostname -I 2>/dev/null | tr ' ' '\n' | grep -qx "$host"; then
    warn "Public URL" "${url} — this machine does not have ${host} (now: $(hostname -I 2>/dev/null | awk '{print $1}'))"
    hint "Update ARCIIN_PUBLIC_URL in .env (or give the server a fixed IP / DHCP reservation), then restart"
  else
    pass "Public URL" "$url"
  fi
}

report_storage() {
  local path="$1" as="${2:-}" state
  state="$(arciin_probe_storage_state "$path" "$as")"
  case "$state" in
    valid_arciin|empty) pass "Storage" "${path} (${state}; create/rename/delete test passed)" ;;
    partial) warn "Storage" "${path} contains non-Arciin files (nothing was touched)" ;;
    mount_missing) bad "Storage" "${path}: its disk is not mounted"; hint "Mount it (sudo mount -a), then restart Arciin" ;;
    read_only) bad "Storage" "${path} is read-only" ;;
    wrong_owner) bad "Storage" "${path} is not writable${as:+ by uid:gid ${as}}"; hint "sudo chown -R ${as:-$(id -u):$(id -g)} ${path}" ;;
    missing) bad "Storage" "${path} does not exist" ;;
  esac
}

report_license_db() {
  # $1: a command that runs psql against the arciin database and prints one row
  local row
  row="$("$@" 2>/dev/null | head -1)"
  if [[ -z "$row" ]]; then warn "License" "no instance yet — open /setup to claim it"; return; fi
  local id plan status source
  IFS='|' read -r id plan status source <<<"$row"
  pass "Instance" "${id:0:8}… (stable while the database is kept)"
  case "$status" in
    active|grace) pass "License" "${plan} — ${status} (${source})" ;;
    none|"") pass "License" "free plan (no paid license activated)" ;;
    *) warn "License" "${plan} — ${status}; open Settings → License (seats: https://arciin.com/account)" ;;
  esac
}

LICENSE_SQL='SELECT id, "licensePlan", "licenseStatus", coalesce("licenseSource", '"'"'-'"'"') FROM "InstanceConfig" LIMIT 1'

# ── native ───────────────────────────────────────────────────────────────────
doctor_native() {
  section "Arciin (native / PM2)"
  local version sha
  version="$(grep -m1 '"version"' "${ROOT_DIR}/package.json" | cut -d'"' -f4)"
  sha="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  pass "Version" "${version} (${sha})"
  check_env_file

  section "Services"
  local svc
  for svc in postgresql redis-server; do
    if [[ "$(systemctl is-active "$svc" 2>/dev/null)" == "active" ]]; then
      [[ "$(systemctl is-enabled "$svc" 2>/dev/null)" == "enabled" ]] && pass "$svc" "running, starts on boot" || bad "$svc" "running but NOT enabled on boot — sudo systemctl enable $svc"
    else
      bad "$svc" "not running — sudo systemctl enable --now $svc"
    fi
  done
  local unit="pm2-$(id -un)"
  if [[ "$(systemctl is-enabled "$unit" 2>/dev/null)" == "enabled" ]]; then pass "Boot (PM2)" "${unit} enabled"; else bad "Boot (PM2)" "${unit} not enabled — Arciin will not start after a reboot"; hint "./install.sh --repair"; fi
  if command -v pm2 >/dev/null 2>&1; then
    local name status dump="${PM2_HOME:-$HOME/.pm2}/dump.pm2"
    for name in arciin-api arciin-worker arciin-web; do
      status="$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; print(next((p['pm2_env']['status'] for p in json.load(sys.stdin) if p['name']=='$name'),'missing'))" 2>/dev/null)"
      [[ "$status" == "online" ]] && pass "$name" "online" || bad "$name" "${status:-missing} — pm2 logs ${name} --lines 40"
      # dump.pm2 is pretty-printed JSON ("name": "x"), so allow whitespace.
      grep -qE "\"name\"[[:space:]]*:[[:space:]]*\"${name}\"" "$dump" 2>/dev/null || bad "Saved for boot" "${name} not in PM2's saved list — pm2 save"
    done
  else
    bad "PM2" "not installed — ./install.sh --repair"
  fi

  section "Database"
  local url auth
  url="$(env_value DATABASE_URL)"
  if [[ -z "$url" ]]; then bad "Database login" "DATABASE_URL not set in .env"; else
    auth="$(arciin_probe_db_auth "$url")"
    case "$auth" in
      ok) pass "Database login" "authenticated with the .env credentials" ;;
      auth_failed) bad "Database login" "PostgreSQL is running, but the .env credentials are rejected"; hint "./install.sh --repair realigns the role with .env (no data change)" ;;
      *) bad "Database login" "${auth}" ;;
    esac
    if [[ "$auth" == "ok" ]]; then
      local status_out
      status_out="$(cd "$ROOT_DIR" && pnpm exec prisma migrate status 2>&1)"
      if grep -q "up to date" <<<"$status_out"; then pass "Migrations" "up to date"; else warn "Migrations" "pending or unclear — ./install.sh --repair applies them after a backup"; fi
      report_license_db psql -X -tAq "$url" -c "$LICENSE_SQL"
    fi
  fi

  section "Storage"
  report_storage "$(env_value ARCIIN_DATA_DIR)"

  section "Network"
  local web api
  web="$(env_value PORT)"; api="$(env_value API_PORT)"
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${api:-4000}/api/health" && pass "API" "http://127.0.0.1:${api:-4000}/api/health" || bad "API" "not answering on :${api:-4000}"
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${web:-3000}/login" && pass "Web" "http://127.0.0.1:${web:-3000}" || bad "Web" "not answering on :${web:-3000}"
  report_public_url "$(env_value ARCIIN_PUBLIC_URL)"

  section "License service"
  ( set -a; . "$ENV_FILE" 2>/dev/null; set +a; node "${ROOT_DIR}/scripts/license-preflight.mjs" ) || PROBLEMS=$((PROBLEMS + 1))
}

# ── docker ───────────────────────────────────────────────────────────────────
doctor_docker() {
  section "Arciin (Docker)"
  if ! docker info >/dev/null 2>&1; then bad "Docker" "daemon not reachable (is it running? is $(id -un) in the docker group?)"; return; fi
  if command -v systemctl >/dev/null 2>&1; then
    [[ "$(systemctl is-enabled docker 2>/dev/null)" == "enabled" ]] && pass "Docker on boot" "enabled" || bad "Docker on boot" "not enabled — sudo systemctl enable docker"
  fi
  pass "Install dir" "$COMPOSE_DIR"
  check_env_file

  section "Images"
  local svc img ver versions=""
  for svc in web api worker; do
    img="$(env_value "ARCIIN_IMAGE_$(tr a-z A-Z <<<"$svc")")"
    ver="$(docker image inspect "${img:-none}" --format '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null)"
    [[ "$img" == *":latest" ]] && warn "$svc image" "${img} — not pinned to a release" || pass "$svc image" "${img:-unset} (${ver:-?})"
    versions+="${ver:-?} "
  done
  [[ "$(tr ' ' '\n' <<<"$versions" | grep -v '^$' | sort -u | wc -l)" == "1" ]] && pass "Versions" "web, api and worker match (${versions%% *})" || bad "Versions" "mixed: ${versions}"

  section "Containers"
  local name state health policy expected=(caddy web api worker postgres redis)
  for name in "${expected[@]}"; do
    state="$(docker inspect -f '{{.State.Status}}' "${PROJECT}-${name}-1" 2>/dev/null || echo missing)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "${PROJECT}-${name}-1" 2>/dev/null)"
    policy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "${PROJECT}-${name}-1" 2>/dev/null)"
    if [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "-" ) ]]; then pass "$name" "running${health:+, $health}"; else bad "$name" "${state}${health:+, $health} — docker logs ${PROJECT}-${name}-1 --tail 40"; fi
    [[ "$policy" == "unless-stopped" || "$policy" == "always" ]] || { [[ "$state" != "missing" ]] && bad "$name restart" "policy '${policy:-none}' — it will not come back after a reboot"; }
  done

  section "Database"
  local auth_out
  auth_out="$(dc run --rm --no-deps -T --entrypoint sh api -c 'PGCONNECT_TIMEOUT=5 psql -X -tAq "$DATABASE_URL" -c "SELECT 1"' 2>&1)"
  case "$(arciin_classify_db_auth "$?" "$auth_out")" in
    ok) pass "Database login" "authenticated with the .env credentials"
        if dc exec -T api sh -c 'pnpm exec prisma migrate status' 2>/dev/null | grep -q "up to date"; then pass "Migrations" "up to date"; else warn "Migrations" "pending or unclear"; fi
        report_license_db dc exec -T postgres psql -U arciin -d arciin -X -tAq -c "$LICENSE_SQL" ;;
    auth_failed) bad "Database login" "PostgreSQL is running, but the password in .env does not match the existing database volume"
        hint "Your data has NOT been deleted. Restore the previous .env, or run the installer with --repair to enter the existing password." ;;
    *) bad "Database login" "could not connect (is the postgres container running?)" ;;
  esac

  section "Storage"
  local host_dir puid pgid
  host_dir="$(env_value ARCIIN_HOST_DATA_DIR)"; puid="$(env_value ARCIIN_PUID)"; pgid="$(env_value ARCIIN_PGID)"
  if docker inspect "${PROJECT}-api-1" >/dev/null 2>&1 && dc exec -T api sh -c 'p=/data/arciin/.doctor-$$ && echo ok > $p && mv $p $p.r && rm -f $p.r' 2>/dev/null; then
    pass "Storage" "${host_dir:-?} writable by the containers (uid ${puid:-1000}:${pgid:-1000})"
  else
    report_storage "${host_dir:-/srv/arciin-storage/arciin}" "${puid:-1000}:${pgid:-1000}"
  fi

  section "Network"
  local port
  port="$(env_value ARCIIN_HTTP_PORT)"; port="${port:-80}"
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${port}/api/health" && pass "Web + API" "http://127.0.0.1:${port} (Caddy)" || bad "Web + API" "nothing answering on port ${port}"
  report_public_url "$(env_value ARCIIN_PUBLIC_URL)"

  section "License service (from inside the API container)"
  dc exec -T api node scripts/license-preflight.mjs 2>/dev/null || { PROBLEMS=$((PROBLEMS + 1)); hint "The API container cannot reach the license service — check DNS/egress for containers"; }
}

detect_mode
echo ""
echo -e "  ${B}Arciin doctor${X}  ${D}mode: ${MODE}${X}"
case "$MODE" in
  native) doctor_native ;;
  docker) doctor_docker ;;
  *) bad "Install" "no Arciin installation found here"; hint "Native: ./install.sh   Docker: curl -fsSL https://get.arciin.com/install.sh | bash" ;;
esac
check_host
echo ""
if (( PROBLEMS == 0 )); then echo -e "  ${G}${B}All checks passed.${X}"; else echo -e "  ${R}${B}${PROBLEMS} problem(s) found.${X} ${D}Each line above says what to do; nothing was changed.${X}"; fi
echo ""
(( PROBLEMS == 0 ))
