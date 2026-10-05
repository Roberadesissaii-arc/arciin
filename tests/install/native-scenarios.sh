#!/usr/bin/env bash
#
# Native (PM2) install scenarios. Runs INSIDE a disposable VM as a sudo-capable
# user (see tests/install/vm-harness.sh). It installs Arciin, erases its
# database on purpose and breaks its credentials. Never run it anywhere else.
#
#   ARCIIN_SCENARIO_CONFIRM=disposable bash tests/install/native-scenarios.sh [scenario ...]
#
# Reboots are driven from outside the VM by the harness (post_reboot runs
# after one).
set -uo pipefail

[[ "${ARCIIN_SCENARIO_CONFIRM:-}" == "disposable" ]] || {
  echo "Refusing: set ARCIIN_SCENARIO_CONFIRM=disposable on a throwaway machine." >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=tests/install/lib-scenarios.sh
source "$ROOT/tests/install/lib-scenarios.sh"
cd "$ROOT"

API="http://127.0.0.1:4000/api"
STATE="$LOGS/state"
mkdir -p "$STATE"

env_val() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'; }
pg() { sudo -u postgres psql -X -d arciin -tAq "$@"; }
instance_id() { pg -c 'SELECT id FROM "InstanceConfig" LIMIT 1' 2>/dev/null | head -1; }
marker() { pg -c 'SELECT v FROM ci_marker' 2>/dev/null | head -1; }
data_dir() { env_val ARCIIN_DATA_DIR; }
healthy() {
  curl -fsS --max-time 5 "$API/health" >/dev/null 2>&1 \
    && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null \
    && [[ "$(pm2 jlist 2>/dev/null | python3 -c 'import json,sys;print(sum(1 for p in json.load(sys.stdin) if p["name"] in ("arciin-api","arciin-worker","arciin-web") and p["pm2_env"]["status"]=="online"))')" == "3" ]]
}

# PM2 state and recent logs, for any failed check that involves the processes.
diagnose() {
  {
    pm2 jlist 2>/dev/null | python3 -c 'import json,sys
for p in json.load(sys.stdin): print(p["name"], p["pm2_env"]["status"], "restarts:", p["pm2_env"].get("restart_time"))' || true
    for name in arciin-api arciin-worker arciin-web; do
      echo "── ${name} ──"
      pm2 logs "$name" --nostream --lines 60 2>&1 | tail -60
    done
    systemctl status "pm2-$(id -un)" --no-pager 2>&1 | tail -15
  } >"$LOGS/$1.diag" 2>&1
}

install() { # install <log-name> [args] → exit code
  local name="$1"; shift
  local started=$SECONDS rc=0
  ARCIIN_SKIP_INSTALL_CHOICE=1 bash "$ROOT/install.sh" --native "$@" >"$LOGS/$name.log" 2>&1 </dev/null || rc=$?
  echo "    (${name}: exit ${rc}, $((SECONDS - started))s)"
  echo "$((SECONDS - started))" >"$STATE/duration-$name"
  wait_until 60 healthy || diagnose "$name"
  return "$rc"
}

scenario_fresh() {
  if [[ "${ARCIIN_SCENARIO_DOCKER_ENV:-0}" == "1" ]]; then
    # The owner's Ubuntu 26.04.1 path: an .env left by a Docker install (no
    # DATABASE_URL, Compose-only keys, Docker storage path) before the first
    # native run. It used to die with "raw: unbound variable".
    cat > "$ROOT/.env" <<'ENV'
NODE_ENV=production
ARCIIN_HOST_DATA_DIR=/srv/arciin-storage/arciin
ARCIIN_DATA_DIR=/data/arciin
POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef0123456789abcdef
REDIS_PASSWORD=fedcba9876543210fedcba9876543210fedcba9876543210
ARCIIN_IMAGE_API=ghcr.io/roberadesissaii-arc/arciin-api:1.1.3
ENV
    chmod 600 "$ROOT/.env"
  fi
  install fresh; local rc=$?
  if [[ "${ARCIIN_SCENARIO_DOCKER_ENV:-0}" == "1" ]]; then
    check "Docker-style .env: no unbound variable" "! grep -q 'unbound variable' $LOGS/fresh.log"
    check "Docker-style .env: credential case named, not a crash" "grep -q '.env has no DATABASE_URL' $LOGS/fresh.log"
  fi
  check "fresh native install exits 0" "[[ $rc == 0 ]]"
  check "API, web and worker online and healthy" "wait_until 120 healthy"
  check "PM2 boot unit enabled" "systemctl is-enabled pm2-$(id -un) >/dev/null"
  check "PM2 saved list holds all three processes" \
    "grep -q arciin-api ~/.pm2/dump.pm2 && grep -q arciin-worker ~/.pm2/dump.pm2 && grep -q arciin-web ~/.pm2/dump.pm2"
  check "journal records native mode and completion" \
    "grep -q '\"mode\": \"native\"' ~/.local/state/arciin/install-state.json"
  check ".env is mode 600" "[[ \$(stat -L -c %a $ROOT/.env) == 600 ]]"
  check "doctor reports all green" "bash scripts/arciin-doctor.sh --native >$LOGS/doctor-native.log 2>&1"
  local pw; pw="$(env_val DATABASE_URL | sed -n 's#.*://[^:]*:\([^@]*\)@.*#\1#p')"
  check "no database password in installer output" "[[ -n '$pw' ]] && ! grep -qF '$pw' $LOGS/fresh.log"

  local origin; origin="$(env_val ARCIIN_PUBLIC_URL)"
  check "instance can be claimed" "claim_instance '$API' '$origin' '$(env_val ARCIIN_SETUP_TOKEN)' '$(data_dir)'"
  instance_id >"$STATE/instance-id"
  pg -c "CREATE TABLE IF NOT EXISTS ci_marker (v text); DELETE FROM ci_marker; INSERT INTO ci_marker VALUES ('n1');" >/dev/null
  echo n1 | sudo tee "$(data_dir)/objects/ci-marker.txt" >/dev/null
}

scenario_repair() {
  install repair; local rc=$?
  check "re-running install.sh (repair) exits 0" "[[ $rc == 0 ]] && wait_until 120 healthy"
  check "instance ID preserved" "[[ \$(instance_id) == \$(cat $STATE/instance-id) ]]"
  check "database row kept" "[[ \$(marker) == n1 ]]"
  check "a pre-repair database backup was written" "ls -d \$(data_dir)/backups/repair-* >/dev/null 2>&1"
  check "repair reused the build" "[[ \$(cat $STATE/duration-repair) -lt \$(cat $STATE/duration-fresh) ]]"
}

scenario_credential_drift() {
  # The role's password no longer matches .env: the classic "API restarts
  # forever with P1000" state.
  pg -c "ALTER ROLE arciin WITH PASSWORD '$(openssl rand -hex 16)'" >/dev/null 2>&1 \
    || sudo -u postgres psql -X -q -c "ALTER ROLE arciin WITH PASSWORD '$(openssl rand -hex 16)'" >/dev/null
  pm2 restart arciin-api >/dev/null 2>&1
  install credential-drift; local rc=$?
  check "install.sh re-aligns the role to .env and recovers" "[[ $rc == 0 ]] && wait_until 120 healthy"
  check "instance ID preserved through credential repair" "[[ \$(instance_id) == \$(cat $STATE/instance-id) ]]"
  check "database row kept" "[[ \$(marker) == n1 ]]"
}

scenario_fresh_requires_phrase() {
  install fresh-refused --fresh; local rc=$?
  check "--fresh without the typed phrase is refused" "[[ $rc != 0 ]] && [[ \$(marker) == n1 ]]"
  ARCIIN_CONFIRM_ERASE="ERASE ARCIIN" install fresh-confirmed --fresh; rc=$?
  check "--fresh with the phrase reinstalls" "[[ $rc == 0 ]] && wait_until 120 healthy"
  check "the old database is gone" "[[ -z \$(marker) ]]"
  check "uploaded files survive --fresh" "[[ \$(sudo cat \$(data_dir)/objects/ci-marker.txt) == n1 ]]"
}

scenario_post_reboot() {
  local n="${ARCIIN_REBOOT_INDEX:-1}"
  check "after reboot ${n}: Arciin came back on its own" "wait_until 300 healthy" || true
  healthy || diagnose "reboot-${n}"
  check "after reboot ${n}: instance ID unchanged" "[[ \$(instance_id) == \$(cat $STATE/instance-id) ]]"
  check "after reboot ${n}: database row kept" "[[ \$(marker) == n1 ]]"
}

scenario_license_seat() {
  local key="${ARCIIN_TEST_LICENSE_KEY:-}"
  [[ -n "$key" ]] || { echo "    (no ARCIIN_TEST_LICENSE_KEY — skipped)"; return 0; }
  local origin; origin="$(env_val ARCIIN_PUBLIC_URL)"
  activate_license "$API" "$origin" "$key" >"$LOGS/license-activate-1.json"
  check "a test licence activates on this server" "grep -q '\"plan\"' $LOGS/license-activate-1.json && ! grep -q '\"error\"' $LOGS/license-activate-1.json"
}

scenario_license_seat_after_fresh() {
  local key="${ARCIIN_TEST_LICENSE_KEY:-}"
  [[ -n "$key" ]] || return 0
  local origin; origin="$(env_val ARCIIN_PUBLIC_URL)"
  claim_instance "$API" "$origin" "$(env_val ARCIIN_SETUP_TOKEN)" "$(data_dir)"
  activate_license "$API" "$origin" "$key" >"$LOGS/license-activate-2.json"
  check "a reinstalled server (new instance ID) hits SERVER_LIMIT_REACHED" "grep -q SERVER_LIMIT_REACHED $LOGS/license-activate-2.json"
  local short; short="$(cut -c1-8 "$STATE/instance-id")"
  check "the error names the server holding the seat" "grep -qF '\"instanceIdShort\":\"$short\"' $LOGS/license-activate-2.json"
  check "the error points to arciin.com/account" "grep -q 'arciin.com/account' $LOGS/license-activate-2.json"
}

scenario_uninstall() {
  install uninstall --uninstall; local rc=$?
  check "--uninstall exits 0 and stops Arciin" "[[ $rc == 0 ]] && ! curl -fsS $API/health >/dev/null 2>&1"
  check "--uninstall keeps the database" "sudo -u postgres psql -X -tAc \"SELECT 1 FROM pg_database WHERE datname='arciin'\" | grep -q 1"
  check "--uninstall keeps files and .env" "[[ -f $ROOT/.env ]] && sudo test -f \$(data_dir)/objects/ci-marker.txt"
}

ALL=(fresh repair credential_drift)
for s in "${@:-${ALL[@]}}"; do
  CURRENT="$s"
  echo "▸ ${s}"
  "scenario_${s}"
done
finish
