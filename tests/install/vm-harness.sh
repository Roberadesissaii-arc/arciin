#!/usr/bin/env bash
#
# Disposable-VM install tests: one LXD virtual machine per run, real reboots.
#
#   bash tests/install/vm-harness.sh <ubuntu-release> <native|docker>
#
# Runs on a CI runner (or another machine that exists to be thrown away) with
# LXD and /dev/kvm. Never on a server that runs Arciin: it launches VMs,
# binds ports and exercises erase paths.
#
# Environment (all optional):
#   ARCIIN_VM_AUTHORITY=<dir>    test-authority.mts output (license-key, public-keys)
#   ARCIIN_VM_MANIFEST_DIR=<dir> release assets + stable.json for Docker mode
#   ARCIIN_VM_REGISTRY=<host:port> insecure registry the manifest's images live in
set -uo pipefail

RELEASE="${1:?ubuntu release, e.g. 24.04}"
MODE="${2:?native or docker}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VM="arciin-${MODE}-${RELEASE//./}"
LOGS="${ARCIIN_SCENARIO_LOGS:-$ROOT/install-logs}/${VM}"
mkdir -p "$LOGS"
TIMES="$LOGS/timings.tsv"
: >"$TIMES"
LXC=(sudo lxc)
HOST_IP="$(ip -4 addr show lxdbr0 | awk '/inet /{print $2}' | cut -d/ -f1)"

log() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
in_vm() { "${LXC[@]}" exec "$VM" -- "$@"; }
as_user() { "${LXC[@]}" exec "$VM" --user 1000 --group 1000 --cwd /home/ubuntu/arciin --env HOME=/home/ubuntu -- bash -lc "$*"; }
timing() { printf '%s\t%s\n' "$1" "$2" | tee -a "$TIMES"; }

launch() {
  log "Launching ${VM} (Ubuntu ${RELEASE}, VM)"
  local image="ubuntu:${RELEASE}"
  "${LXC[@]}" image info "$image" >/dev/null 2>&1 || image="ubuntu-daily:${RELEASE}"
  "${LXC[@]}" launch "$image" "$VM" --vm -c limits.cpu=4 -c limits.memory=8GiB -d root,size=40GiB
  local i
  for i in $(seq 1 90); do in_vm true >/dev/null 2>&1 && break; sleep 5; done
  in_vm cloud-init status --wait >/dev/null 2>&1 || true
  in_vm bash -c 'echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/90-arciin-test'
}

push_repo() {
  log "Copying this checkout into the VM"
  tar -C "$ROOT" --exclude=./node_modules --exclude='./apps/*/node_modules' --exclude='./packages/*/node_modules' \
    --exclude='./apps/web/.next' --exclude=./install-logs -cf - . \
    | in_vm bash -c 'mkdir -p /home/ubuntu/arciin && tar -xf - -C /home/ubuntu/arciin && chown -R 1000:1000 /home/ubuntu/arciin'
}

# Real reboot: the whole VM restarts, then the time until Arciin answers is measured.
reboot_and_measure() {
  local n="$1" probe="$2" started
  log "Reboot ${n}"
  started=$(date +%s)
  "${LXC[@]}" restart "$VM" --timeout 120
  local i
  for i in $(seq 1 120); do in_vm true >/dev/null 2>&1 && break; sleep 2; done
  for i in $(seq 1 150); do
    if in_vm bash -c "$probe" >/dev/null 2>&1; then
      timing "reboot-${n}-seconds-until-healthy" "$(( $(date +%s) - started ))"
      return 0
    fi
    sleep 2
  done
  timing "reboot-${n}-seconds-until-healthy" "timeout"
  return 1
}

license_env_lines() {
  [[ -n "${ARCIIN_VM_AUTHORITY:-}" ]] || return 0
  printf 'ARCIIN_LICENSE_SERVER_URL=http://%s:4398\nARCIIN_LICENSE_PUBLIC_KEYS=%s\n' "$HOST_IP" "$(cat "$ARCIIN_VM_AUTHORITY/public-keys")"
}
license_key_env() {
  [[ -n "${ARCIIN_VM_AUTHORITY:-}" ]] && printf 'ARCIIN_TEST_LICENSE_KEY=%q' "$(cat "$ARCIIN_VM_AUTHORITY/license-key")"
}

run_native() {
  local base="ARCIIN_SCENARIO_CONFIRM=disposable ARCIIN_SCENARIO_LOGS=/home/ubuntu/arciin/install-logs $(license_key_env)"
  # 26.04 replays the owner's failure: a Docker-style .env before the first native run.
  local docker_env=0
  [[ "$RELEASE" == "26.04" ]] && docker_env=1
  as_user "$base ARCIIN_SCENARIO_DOCKER_ENV=$docker_env bash tests/install/native-scenarios.sh fresh"
  if [[ -n "${ARCIIN_VM_AUTHORITY:-}" ]]; then
    # Wait for the restarted API before activating (it answered HTTP 000).
    license_env_lines | as_user "cat >> .env && pm2 restart arciin-api >/dev/null && for i in \$(seq 1 60); do curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 && break; sleep 2; done"
    as_user "$base bash tests/install/native-scenarios.sh license_seat"
  fi
  as_user "$base bash tests/install/native-scenarios.sh repair credential_drift"
  local probe='curl -fsS http://127.0.0.1:4000/api/health && curl -fsS -o /dev/null http://127.0.0.1:3000/'
  for n in 1 2; do
    reboot_and_measure "$n" "$probe"
    as_user "$base ARCIIN_REBOOT_INDEX=$n bash tests/install/native-scenarios.sh post_reboot"
  done
  as_user "$base bash tests/install/native-scenarios.sh fresh_requires_phrase license_seat_after_fresh uninstall"
}

run_docker() {
  local reg="${ARCIIN_VM_REGISTRY:?ARCIIN_VM_REGISTRY is required for docker mode}"
  in_vm bash -c "mkdir -p /etc/docker && printf '{\"insecure-registries\":[\"%s\"]}\n' '$reg' >/etc/docker/daemon.json"
  "${LXC[@]}" file push -r -p "$ARCIIN_VM_MANIFEST_DIR" "$VM/home/ubuntu/arciin/dist/" >/dev/null
  local base="ARCIIN_SCENARIO_CONFIRM=disposable ARCIIN_SCENARIO_LOGS=/home/ubuntu/arciin/install-logs ARCIIN_MANIFEST=/home/ubuntu/arciin/dist/release/stable.json $(license_key_env)"
  local run="cd /home/ubuntu/arciin && $base bash tests/install/docker-scenarios.sh"
  in_vm bash -c "$run fresh"
  if [[ -n "${ARCIIN_VM_AUTHORITY:-}" ]]; then
    license_env_lines | in_vm bash -c "cat >> /opt/arciin/.env"
  fi
  in_vm bash -c "$run rerun doctor claim"
  local probe='cd /opt/arciin && [ "$(docker compose ps --format "{{.Health}}" | grep -c "^healthy$")" -ge 5 ] && curl -fsS http://127.0.0.1:8080/api/health'
  for n in 1 2; do
    reboot_and_measure "$n" "$probe"
    in_vm bash -c "ARCIIN_REBOOT_INDEX=$n $run post_reboot"
  done
  in_vm bash -c "$run env_lost_containers_present env_lost_containers_gone wrong_password_rekey worker_db_health port_conflict fresh_requires_phrase license_seat_after_fresh uninstall_keeps_data delete_data"
}

collect() {
  "${LXC[@]}" file pull -r "$VM/home/ubuntu/arciin/install-logs" "$LOGS/" >/dev/null 2>&1 || true
  in_vm bash -c 'journalctl -b -u docker -u "pm2-*" --no-pager | tail -200' >"$LOGS/journal.log" 2>&1 || true
}

launch
push_repo
started=$(date +%s)
if [[ "$MODE" == "native" ]]; then run_native; else run_docker; fi
timing "total-seconds" "$(( $(date +%s) - started ))"
collect

results="$(find "$LOGS" -name results.tsv | head -1)"
if [[ -z "$results" ]]; then echo "no results collected" >&2; exit 1; fi
cp "$results" "$LOGS/results-final.tsv"
echo ""
echo "${VM}: $(grep -c $'\tPASS\t' "$results") passed, $(grep -c $'\tFAIL\t' "$results") failed"
! grep -q $'\tFAIL\t' "$results" && ! grep -q $'\ttimeout' "$TIMES"
