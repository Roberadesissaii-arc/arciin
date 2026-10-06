#!/usr/bin/env bash
# Installation state for Arciin — shared by install.sh (native), the Docker
# installer and `arciin doctor`. Sourced, never executed.
#
# Two layers, kept apart on purpose:
#   * classifiers (arciin_classify_*) are pure: facts in, one state word out.
#     They are what the tests pin, and they never touch a database or disk.
#   * probes (arciin_probe_*) gather those facts from the machine.
#
# Every state is one word so callers can `case` on it. Nothing here prints a
# password, a token or a connection string with credentials in it.

# ── Database ─────────────────────────────────────────────────────────────────
#
# arciin_classify_db <exists> <table_count> <has_prisma_migrations>
#                    <has_instance_config> <has_user> <failed_migrations>
#
#   missing             no database named arciin
#   empty               database exists, no tables in public
#   foreign             tables exist but this is not an Arciin database
#                       (no _prisma_migrations, or none of Arciin's tables)
#   partial_arciin      Arciin's migration table exists but the schema is
#                       incomplete or a migration is recorded as failed
#   valid_arciin        a complete Arciin schema
#
# Credentials are a separate axis (arciin_classify_db_auth): a database can be
# valid_arciin and still unreachable with the configured password.
arciin_classify_db() {
  local exists="$1" tables="${2:-0}" has_migrations="$3" has_instance="$4" has_user="$5" failed="${6:-0}"
  if [[ "$exists" != "1" ]]; then echo missing; return; fi
  if [[ ! "$tables" =~ ^[0-9]+$ || "$tables" -eq 0 ]]; then echo empty; return; fi
  if [[ "$has_migrations" != "1" ]]; then echo foreign; return; fi
  if [[ "$has_instance" != "1" && "$has_user" != "1" ]]; then
    # _prisma_migrations alone, with neither of Arciin's core tables: either a
    # first migration that failed early, or another Prisma app's database.
    if [[ "$tables" -le 2 ]]; then echo partial_arciin; else echo foreign; fi
    return
  fi
  if [[ "$has_instance" != "1" || "$has_user" != "1" ]]; then echo partial_arciin; return; fi
  if [[ "$failed" =~ ^[0-9]+$ && "$failed" -gt 0 ]]; then echo partial_arciin; return; fi
  echo valid_arciin
}

# arciin_classify_db_claim <user_count> <instance_count> → claimed | partial | unclaimed
arciin_classify_db_claim() {
  local users="${1:-0}" instances="${2:-0}"
  if [[ "$users" =~ ^[1-9][0-9]*$ ]]; then echo claimed; return; fi
  if [[ "$instances" =~ ^[1-9][0-9]*$ ]]; then echo partial; return; fi
  echo unclaimed
}

# arciin_classify_db_auth <psql exit code> <psql stderr>
#   ok | auth_failed | unreachable | missing_database | error
arciin_classify_db_auth() {
  local code="$1" err="$2"
  if [[ "$code" == "0" ]]; then echo ok; return; fi
  if grep -qiE "password authentication failed|authentication failed|no password supplied|P1000" <<<"$err"; then
    echo auth_failed; return
  fi
  if grep -qiE "database \"[^\"]+\" does not exist|P1003" <<<"$err"; then echo missing_database; return; fi
  if grep -qiE "could not connect|connection refused|timeout expired|could not translate host|No such file or directory|P1001" <<<"$err"; then
    echo unreachable; return
  fi
  echo error
}

# Facts about the arciin database, gathered as the postgres superuser (native).
# Prints `exists tables has_migrations has_instance has_user failed users instances`.
arciin_probe_db_facts_native() {
  local pg_port="${1:-5432}"
  local q=(sudo -u postgres env PGPORT="$pg_port" psql -X -tAq)
  if ! "${q[@]}" -c "SELECT 1 FROM pg_database WHERE datname='arciin'" 2>/dev/null | grep -q 1; then
    echo "0 0 0 0 0 0 0 0"; return
  fi
  local qa=("${q[@]}" -d arciin)
  local tables has_mig has_inst has_user failed=0 users=0 instances=0
  tables="$("${qa[@]}" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d '[:space:]')"
  has_mig="$("${qa[@]}" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations'" 2>/dev/null | tr -d '[:space:]')"
  has_inst="$("${qa[@]}" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='InstanceConfig'" 2>/dev/null | tr -d '[:space:]')"
  has_user="$("${qa[@]}" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='User'" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$has_mig" == "1" ]]; then
    failed="$("${qa[@]}" -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL" 2>/dev/null | tr -d '[:space:]')"
  fi
  [[ "$has_user" == "1" ]] && users="$("${qa[@]}" -c 'SELECT count(*) FROM "User"' 2>/dev/null | tr -d '[:space:]')"
  [[ "$has_inst" == "1" ]] && instances="$("${qa[@]}" -c 'SELECT count(*) FROM "InstanceConfig"' 2>/dev/null | tr -d '[:space:]')"
  echo "1 ${tables:-0} ${has_mig:-0} ${has_inst:-0} ${has_user:-0} ${failed:-0} ${users:-0} ${instances:-0}"
}

# A real, authenticated login with the configured credentials — never
# pg_isready, which answers "accepting connections" to a wrong password.
# Prints the auth state word; returns 0 only for ok.
arciin_probe_db_auth() {
  local database_url="$1" err code
  if ! command -v psql >/dev/null 2>&1; then echo error; return 1; fi
  err="$(PGCONNECT_TIMEOUT=5 psql -X -tAq "$database_url" -c 'SELECT 1' 2>&1 >/dev/null)"
  code=$?
  local state
  state="$(arciin_classify_db_auth "$code" "$err")"
  echo "$state"
  [[ "$state" == "ok" ]]
}

# ── Storage ──────────────────────────────────────────────────────────────────
#
# arciin_classify_storage <exists> <entries> <has_arciin_layout> <writable>
#                         <read_only> <owner_ok> <mount_missing>
#
#   mount_missing   the path is meant to be on a mounted disk that is not mounted
#   missing         does not exist yet (and no mount is missing)
#   read_only       exists but the filesystem refuses writes
#   wrong_owner     exists but this user cannot write it
#   empty           exists, nothing in it
#   valid_arciin    looks like an Arciin storage root (objects/ or libraries/)
#   partial         exists, has other content
arciin_classify_storage() {
  local exists="$1" entries="${2:-0}" layout="$3" writable="$4" read_only="$5" owner_ok="$6" mount_missing="$7"
  if [[ "$mount_missing" == "1" ]]; then echo mount_missing; return; fi
  if [[ "$exists" != "1" ]]; then echo missing; return; fi
  if [[ "$read_only" == "1" ]]; then echo read_only; return; fi
  if [[ "$writable" != "1" || "$owner_ok" != "1" ]]; then echo wrong_owner; return; fi
  if [[ ! "$entries" =~ ^[0-9]+$ || "$entries" -eq 0 ]]; then echo empty; return; fi
  if [[ "$layout" == "1" ]]; then echo valid_arciin; return; fi
  echo partial
}

# Is <path> meant to live on a disk that is not mounted?
#
# A storage path under /mnt or /media (or anywhere, when
# ARCIIN_STORAGE_REQUIRE_MOUNT=1) must not resolve to the root filesystem:
# `mkdir -p /mnt/bigdisk/arciin` on an unplugged disk silently fills / instead.
# Prints 1 when the mount is missing, 0 otherwise.
arciin_storage_mount_missing() {
  local path="$1" ancestor mount_target
  local require="${ARCIIN_STORAGE_REQUIRE_MOUNT:-0}"
  if [[ "$require" != "1" && "$path" != /mnt/* && "$path" != /media/* && "$path" != /run/media/* ]]; then
    echo 0; return
  fi
  ancestor="$path"
  while [[ -n "$ancestor" && "$ancestor" != "/" && ! -e "$ancestor" ]]; do
    ancestor="$(dirname "$ancestor")"
  done
  if ! command -v findmnt >/dev/null 2>&1; then echo 0; return; fi
  mount_target="$(findmnt -n -o TARGET --target "${ancestor:-/}" 2>/dev/null | head -1)"
  if [[ -z "$mount_target" || "$mount_target" == "/" ]]; then echo 1; else echo 0; fi
}

# Create, read, rename and delete a probe file as the current user (or, with a
# uid:gid argument and sudo, as that user — the Docker container's identity).
# Prints `writable read_only`.
arciin_storage_write_test() {
  local dir="$1" as="${2:-}"
  local probe=".arciin-write-test-$$-${RANDOM}"
  local run=(bash -c)
  if [[ -n "$as" ]]; then run=(sudo -n setpriv --reuid="${as%%:*}" --regid="${as##*:}" --clear-groups bash -c); fi
  local out code
  out="$("${run[@]}" "cd '$dir' && printf ok > '$probe' && [[ \$(cat '$probe') == ok ]] && mv '$probe' '$probe.r' && rm -f '$probe.r'" 2>&1)"
  code=$?
  rm -f "$dir/$probe" "$dir/$probe.r" 2>/dev/null || true
  if [[ "$code" == "0" ]]; then echo "1 0"; return; fi
  if grep -qi "read-only file system" <<<"$out"; then echo "0 1"; else echo "0 0"; fi
}

# Prints the storage state word for <path> (current user; optional uid:gid).
arciin_probe_storage_state() {
  local path="$1" as="${2:-}" exists=0 entries=0 layout=0 writable=0 read_only=0 owner_ok=1 mount_missing
  mount_missing="$(arciin_storage_mount_missing "$path")"
  if [[ -d "$path" ]]; then
    exists=1
    entries="$(find "$path" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')"
    if [[ -d "$path/objects" || -d "$path/libraries" ]]; then layout=1; fi
    read -r writable read_only < <(arciin_storage_write_test "$path" "$as")
    [[ "$writable" == "1" ]] || owner_ok=0
  fi
  arciin_classify_storage "$exists" "$entries" "$layout" "$writable" "$read_only" "$owner_ok" "$mount_missing"
}

# ── Native processes ─────────────────────────────────────────────────────────
#
# arciin_classify_native <env_exists> <pm2_present> <processes_online>
#                        <processes_defined> <services_ok> <build_present>
#   none | partial | pm2_missing | processes_missing | services_missing | installed
arciin_classify_native() {
  local env="$1" pm2="$2" online="${3:-0}" defined="${4:-0}" services="$5" build="$6"
  if [[ "$env" != "1" && "$defined" == "0" ]]; then echo none; return; fi
  if [[ "$services" != "1" ]]; then echo services_missing; return; fi
  if [[ "$pm2" != "1" ]]; then echo pm2_missing; return; fi
  if [[ "$defined" -lt 3 ]]; then
    if [[ "$env" == "1" && "$build" != "1" ]]; then echo partial; else echo processes_missing; fi
    return
  fi
  if [[ "$online" -lt 3 ]]; then echo processes_missing; return; fi
  echo installed
}

# ── Docker ───────────────────────────────────────────────────────────────────
#
# arciin_classify_docker <containers_total> <containers_running> <expected>
#                        <volume_exists> <env_exists> <db_auth>
#   none | env_missing | credential_mismatch | stale_containers |
#   existing_volumes | stopped | partial | running
arciin_classify_docker() {
  local total="${1:-0}" running="${2:-0}" expected="${3:-6}" volume="$4" env="$5" auth="${6:-unknown}"
  if [[ "$total" -eq 0 && "$volume" != "1" ]]; then echo none; return; fi
  # Containers but no database volume: left by a stack that never finished.
  if [[ "$volume" != "1" ]]; then echo stale_containers; return; fi
  if [[ "$volume" == "1" && "$env" != "1" ]]; then echo env_missing; return; fi
  if [[ "$auth" == "auth_failed" ]]; then echo credential_mismatch; return; fi
  if [[ "$total" -eq 0 ]]; then echo existing_volumes; return; fi
  if [[ "$running" -eq 0 ]]; then echo stopped; return; fi
  if [[ "$running" -lt "$expected" ]]; then echo partial; return; fi
  echo running
}

# ── Install journal ──────────────────────────────────────────────────────────
#
# A non-secret record of what the installer did, so repair and resume can be
# deterministic. JSON at $ARCIIN_JOURNAL (default
# ${XDG_STATE_HOME:-$HOME/.local/state}/arciin/install-state.json). Values are
# strings; never pass a secret.
arciin_journal_path() {
  echo "${ARCIIN_JOURNAL:-${XDG_STATE_HOME:-$HOME/.local/state}/arciin/install-state.json}"
}

arciin_journal_set() {
  local file key="$1" value="$2"
  file="$(arciin_journal_path)"
  mkdir -p "$(dirname "$file")" 2>/dev/null || return 0
  python3 - "$file" "$key" "$value" <<'PY' 2>/dev/null || true
import json, os, sys, datetime
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path) as fh:
        data = json.load(fh)
except Exception:
    data = {}
data[key] = value
data["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(data, fh, indent=2, sort_keys=True)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY
}

arciin_journal_get() {
  local file
  file="$(arciin_journal_path)"
  [[ -f "$file" ]] || return 0
  python3 - "$file" "$1" <<'PY' 2>/dev/null || true
import json, sys
try:
    print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))
except Exception:
    pass
PY
}

# Record that <step> completed; resume logic asks arciin_journal_done.
arciin_journal_step() {
  arciin_journal_set "step.$1" "done"
  arciin_journal_set "lastCompletedStep" "$1"
}

arciin_journal_done() {
  [[ "$(arciin_journal_get "step.$1")" == "done" ]]
}

# ── Failure report ───────────────────────────────────────────────────────────
#
# Every installer failure ends the same way: what failed, why, whether data is
# safe, and how to recover. Exits 1.
#
#   arciin_fail_report "<what>" "<why>" "<data status>" "<recovery line>"...
arciin_fail_report() {
  local what="$1" why="$2" data="$3"
  shift 3
  local red="\033[31m" bold="\033[1m" dim="\033[2m" reset="\033[0m"
  echo "" >&2
  echo -e "  ${red}✖${reset}  ${bold}${what}${reset}" >&2
  echo "" >&2
  echo -e "  ${bold}Why${reset}" >&2
  echo -e "    ${why}" >&2
  echo "" >&2
  echo -e "  ${bold}Your data${reset}" >&2
  echo -e "    ${data}" >&2
  if [[ $# -gt 0 ]]; then
    echo "" >&2
    echo -e "  ${bold}How to recover${reset}" >&2
    local line
    for line in "$@"; do echo -e "    ${dim}•${reset} ${line}" >&2; done
  fi
  echo "" >&2
  arciin_journal_set "lastFailure" "$what" 2>/dev/null || true
  exit 1
}

# Typed confirmation for destructive actions. Enter, y or yes never count.
# Returns 0 only when the user types the exact phrase. Non-interactive runs
# need ARCIIN_CONFIRM_ERASE set to the same phrase.
arciin_confirm_typed() {
  local phrase="$1" answer
  if [[ ! -t 0 && ! -r /dev/tty ]]; then
    [[ "${ARCIIN_CONFIRM_ERASE:-}" == "$phrase" ]]
    return
  fi
  if [[ -n "${ARCIIN_CONFIRM_ERASE:-}" ]]; then
    [[ "${ARCIIN_CONFIRM_ERASE}" == "$phrase" ]]
    return
  fi
  read -r -p "  Type ${phrase} to continue (anything else cancels): " answer </dev/tty || return 1
  [[ "$answer" == "$phrase" ]]
}
