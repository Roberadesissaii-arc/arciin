#!/usr/bin/env bash
#
# Real-Docker scenarios for the canonical installer (scripts/docker-install.sh).
# Runs on DISPOSABLE machines only — a CI runner or a throwaway VM. It installs
# into /opt/arciin, binds a port, erases volumes on purpose and restarts the
# Docker daemon. Never run it on a server with an Arciin you care about.
#
#   ARCIIN_SCENARIO_CONFIRM=disposable \
#   ARCIIN_MANIFEST=/path/stable.json \
#   bash tests/install/docker-scenarios.sh [scenario ...]
#
# Each scenario asserts that data written before it is still there after it,
# unless the scenario's point is an explicit, confirmed erase.
set -uo pipefail

[[ "${ARCIIN_SCENARIO_CONFIRM:-}" == "disposable" ]] || {
  echo "Refusing: set ARCIIN_SCENARIO_CONFIRM=disposable on a throwaway machine." >&2; exit 2; }
[[ -n "${ARCIIN_MANIFEST:-}" ]] || { echo "ARCIIN_MANIFEST is required" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ARCIIN_DIR="${ARCIIN_DIR:-/opt/arciin}"
export ARCIIN_HOST_DATA_DIR="${ARCIIN_HOST_DATA_DIR:-/srv/arciin-storage/arciin}"
export ARCIIN_HTTP_PORT="${ARCIIN_HTTP_PORT:-8080}"
export ARCIIN_ASSUME_YES=1
export ARCIIN_LOCAL_ASSETS="$ROOT"
LOGS="${ARCIIN_SCENARIO_LOGS:-$ROOT/install-logs}"
mkdir -p "$LOGS"
RESULTS="$LOGS/results.tsv"
: >"$RESULTS"
FAILED=0
CURRENT=""

pass() { printf '  \033[32mPASS\033[0m %s — %s\n' "$CURRENT" "$1"; printf '%s\tPASS\t%s\n' "$CURRENT" "$1" >>"$RESULTS"; }
fail() { printf '  \033[31mFAIL\033[0m %s — %s\n' "$CURRENT" "$1"; printf '%s\tFAIL\t%s\n' "$CURRENT" "$1" >>"$RESULTS"; FAILED=$((FAILED + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

dc() { docker compose -p arciin --project-directory "$ARCIIN_DIR" -f "$ARCIIN_DIR/docker-compose.yml" --env-file "$ARCIIN_DIR/.env" "$@"; }
psql_arciin() { docker exec -i arciin-postgres-1 psql -X -U arciin -d arciin -tAq "$@"; }
env_val() { grep -E "^$1=" "$ARCIIN_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2-; }
fingerprint() { env_val POSTGRES_PASSWORD | sha256sum | cut -c1-12; }

install() { # install <log-name> [args] → exit code; full output in $LOGS
  local name="$1"; shift
  local started=$SECONDS rc=0
  bash "$ROOT/scripts/docker-install.sh" "$@" >"$LOGS/$name.log" 2>&1 </dev/null || rc=$?
  echo "    (${name}: exit ${rc}, $((SECONDS - started))s)"
  return "$rc"
}

# The public path: the bootstrapper reads the manifest, downloads the installer
# and its assets from assets_base and verifies every checksum.
install_bootstrap() {
  local name="$1"; shift
  local started=$SECONDS rc=0
  env -u ARCIIN_LOCAL_ASSETS ARCIIN_MANIFEST_URL="file://${ARCIIN_MANIFEST}" \
    bash "$ROOT/scripts/install-bootstrap.sh" "$@" >"$LOGS/$name.log" 2>&1 </dev/null || rc=$?
  echo "    (${name}: exit ${rc}, $((SECONDS - started))s)"
  return "$rc"
}

write_marker() {
  psql_arciin -c "CREATE TABLE IF NOT EXISTS ci_marker (v text); DELETE FROM ci_marker; INSERT INTO ci_marker VALUES ('$1');" >/dev/null
  echo "$1" >"$ARCIIN_HOST_DATA_DIR/objects/ci-marker.txt"
}
marker() { psql_arciin -c "SELECT v FROM ci_marker" 2>/dev/null | head -1; }
file_marker() { cat "$ARCIIN_HOST_DATA_DIR/objects/ci-marker.txt" 2>/dev/null; }

all_healthy() {
  local lines
  lines="$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)"
  [[ "$(wc -l <<<"$lines")" -ge 6 ]] && [[ -z "$(awk '$2 != "running" || ($3 != "" && $3 != "healthy")' <<<"$lines")" ]]
}
wait_until() { # wait_until <seconds> <condition>
  local deadline=$((SECONDS + $1))
  while ((SECONDS < deadline)); do eval "$2" && return 0; sleep 3; done
  return 1
}
no_secret_in() { # the log must not contain the database or redis password
  local pw rpw; pw="$(env_val POSTGRES_PASSWORD)"; rpw="$(env_val REDIS_PASSWORD)"
  [[ -n "$pw" ]] && ! grep -qF "$pw" "$1" && ! grep -qF "$rpw" "$1"
}

scenario_fresh() {
  install_bootstrap fresh; local rc=$?
  check "fresh install through the one-liner bootstrapper exits 0" "[[ $rc == 0 ]]"
  check "installer assets verified and installed" \
    "[[ -x $ARCIIN_DIR/docker-install.sh && -f $ARCIIN_DIR/install-state.sh && -f $ARCIIN_DIR/Caddyfile ]]"
  check "images pinned by digest in .env" "env_val ARCIIN_IMAGE_API | grep -q '@sha256:'"
  check "all six services healthy" all_healthy
  check "API answers through Caddy" "curl -fsS http://127.0.0.1:${ARCIIN_HTTP_PORT}/api/health >/dev/null"
  check "every container restarts unless-stopped" \
    "[[ -z \"\$(docker ps -a --filter label=com.docker.compose.project=arciin --format '{{.Names}}' | xargs docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' | grep -v unless-stopped)\" ]]"
  check ".env is mode 600" "[[ \$(stat -c %a $ARCIIN_DIR/.env) == 600 ]]"
  check ".env backed up beside the install and on the data disk" \
    "ls $ARCIIN_DIR/backups/env/*.env >/dev/null 2>&1 && [[ -f $ARCIIN_HOST_DATA_DIR/backups/install/latest.env ]]"
  check "journal records docker mode and completion" \
    "grep -q '\"mode\": \"docker\"' $ARCIIN_DIR/install-state.json && grep -q '\"step.complete\": \"done\"' $ARCIIN_DIR/install-state.json"
  check "no password appears in the installer output" "no_secret_in $LOGS/fresh.log"
  check "worker reports the database heartbeat" \
    "docker exec arciin-redis-1 sh -c 'redis-cli -a \"\$REDIS_PASSWORD\" --no-auth-warning get arciin:worker:heartbeat:db' | grep -q '^[0-9]'"
  write_marker "m1"
}

scenario_rerun() {
  local before; before="$(fingerprint)"
  install rerun; local rc=$?
  check "re-running the installer exits 0" "[[ $rc == 0 ]]"
  check "database row kept" "[[ \$(marker) == m1 ]]"
  check "uploaded file kept" "[[ \$(file_marker) == m1 ]]"
  check "password unchanged" "[[ \$(fingerprint) == $before ]]"
  check "a pre-upgrade backup was written" "ls -d $ARCIIN_HOST_DATA_DIR/backups/repair-* >/dev/null 2>&1"
}

scenario_doctor() {
  local rc=0
  bash "$ARCIIN_DIR/arciin-doctor.sh" --docker >"$LOGS/doctor.log" 2>&1 || rc=$?
  check "doctor (installed copy) reports all green" "[[ $rc == 0 ]]"
  check "doctor prints no password" "no_secret_in $LOGS/doctor.log"
}

scenario_env_lost_containers_present() {
  local before; before="$(fingerprint)"
  rm -f "$ARCIIN_DIR/.env"
  install env-lost-1; local rc=$?
  check "recovers when .env is deleted (containers present)" "[[ $rc == 0 ]]"
  check "recovered from the containers, not regenerated" "grep -q 'Found settings that open your database: the existing Arciin containers' $LOGS/env-lost-1.log"
  check "original password restored" "[[ \$(fingerprint) == $before ]]"
  check "database row kept" "[[ \$(marker) == m1 ]]"
}

scenario_env_lost_containers_gone() {
  local before; before="$(fingerprint)"
  dc down >/dev/null 2>&1
  rm -f "$ARCIIN_DIR/.env"
  install env-lost-2; local rc=$?
  check "recovers when .env and containers are gone" "[[ $rc == 0 ]]"
  check "recovered from a backup" "grep -q 'Found settings that open your database: backup' $LOGS/env-lost-2.log"
  check "original password restored" "[[ \$(fingerprint) == $before ]]"
  check "database row kept" "[[ \$(marker) == m1 ]]"
}

scenario_wrong_password_rekey() {
  dc down >/dev/null 2>&1
  mkdir -p "$LOGS/hidden-backups"
  mv "$ARCIIN_DIR/backups/env"/*.env "$LOGS/hidden-backups/" 2>/dev/null
  mv "$ARCIIN_HOST_DATA_DIR/backups/install/latest.env" "$LOGS/hidden-backups/data-latest.env" 2>/dev/null
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" "$ARCIIN_DIR/.env"
  local after; after="$(fingerprint)"
  install wrong-password; local rc=$?
  check "a wrong password is detected as a credential mismatch" "grep -q 'does not open the existing Arciin database' $LOGS/wrong-password.log"
  check "re-key keeps the data and the install succeeds" "[[ $rc == 0 && \$(marker) == m1 ]]"
  check "the .env password is the one now in use" "[[ \$(fingerprint) == $after ]]"
}

scenario_daemon_restart() {
  sudo systemctl restart docker
  check "stack returns after a Docker daemon restart" "wait_until 240 all_healthy"
  check "database row kept after restart" "[[ \$(marker) == m1 ]]"
}

scenario_worker_db_health() {
  docker stop arciin-postgres-1 >/dev/null
  check "worker turns unhealthy when PostgreSQL is gone" \
    "wait_until 240 '[[ \$(docker inspect -f {{.State.Health.Status}} arciin-worker-1) == unhealthy ]]'"
  docker start arciin-postgres-1 >/dev/null
  check "worker recovers when PostgreSQL returns" \
    "wait_until 240 '[[ \$(docker inspect -f {{.State.Health.Status}} arciin-worker-1) == healthy ]]'"
}

scenario_port_conflict() {
  python3 -m http.server 8091 --bind 0.0.0.0 >/dev/null 2>&1 &
  local pid=$!
  sleep 1
  ARCIIN_DIR=/opt/arciin-portcheck ARCIIN_COMPOSE_PROJECT=arciin-portcheck ARCIIN_HTTP_PORT=8091 \
    ARCIIN_HOST_DATA_DIR=/srv/arciin-storage/portcheck install port-conflict; local rc=$?
  kill "$pid" 2>/dev/null
  check "a busy port stops the install" "[[ $rc != 0 ]]"
  check "the message names the port and its owner" "grep -q 'Port 8091 is already in use' $LOGS/port-conflict.log && grep -q 'python' $LOGS/port-conflict.log"
  check "four-part error (what / why / data / recover)" \
    "grep -q 'Why' $LOGS/port-conflict.log && grep -q 'Your data' $LOGS/port-conflict.log && grep -q 'How to recover' $LOGS/port-conflict.log"
}

scenario_fresh_requires_phrase() {
  install fresh-refused --fresh; local rc=$?
  check "--fresh without the typed phrase is refused" "[[ $rc != 0 ]]"
  check "database row kept after the refused erase" "[[ \$(marker) == m1 ]]"
  ARCIIN_CONFIRM_ERASE="ERASE ARCIIN" install fresh-confirmed --fresh; rc=$?
  check "--fresh with the phrase reinstalls" "[[ $rc == 0 ]] && all_healthy"
  check "the database was erased" "[[ -z \$(marker) ]]"
  check "uploaded files survive --fresh" "[[ \$(file_marker) == m1 ]]"
  check "the erased database was backed up first" "[[ \$(ls -d $ARCIIN_HOST_DATA_DIR/backups/repair-* | wc -l) -ge 2 ]]"
  write_marker "m2"
}

scenario_uninstall_keeps_data() {
  install uninstall --uninstall; local rc=$?
  check "--uninstall exits 0" "[[ $rc == 0 ]]"
  check "containers removed" "[[ -z \$(docker ps -aq --filter label=com.docker.compose.project=arciin) ]]"
  check "database volume kept" "docker volume inspect arciin_postgres_data >/dev/null"
  install reinstall; rc=$?
  check "reinstall picks the data back up" "[[ $rc == 0 && \$(marker) == m2 ]]"
}

scenario_delete_data() {
  install delete-refused --uninstall --delete-data; local rc=$?
  check "--delete-data without the phrase is refused" "[[ $rc != 0 ]] && docker volume inspect arciin_postgres_data >/dev/null"
  ARCIIN_CONFIRM_ERASE="ERASE ARCIIN" install delete-confirmed --uninstall --delete-data; rc=$?
  check "--delete-data with the phrase removes the volumes" "[[ $rc == 0 ]] && ! docker volume inspect arciin_postgres_data >/dev/null 2>&1"
  check "files are kept unless --delete-storage" "[[ \$(file_marker) == m2 ]]"
}

ALL=(fresh rerun doctor env_lost_containers_present env_lost_containers_gone wrong_password_rekey
     daemon_restart worker_db_health port_conflict fresh_requires_phrase uninstall_keeps_data delete_data)
for s in "${@:-${ALL[@]}}"; do
  CURRENT="$s"
  echo "▸ ${s}"
  "scenario_${s}"
done

echo ""
echo "Results: $(grep -c PASS "$RESULTS") passed, ${FAILED} failed  (logs: ${LOGS})"
[[ "$FAILED" == "0" ]]
