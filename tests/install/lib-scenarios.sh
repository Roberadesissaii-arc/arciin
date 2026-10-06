#!/usr/bin/env bash
# Shared helpers for the install scenario scripts (sourced). Disposable
# machines only — see docker-scenarios.sh / native-scenarios.sh.

LOGS="${ARCIIN_SCENARIO_LOGS:-$PWD/install-logs}"
mkdir -p "$LOGS"
RESULTS="$LOGS/results.tsv"
[[ -f "$RESULTS" ]] || : >"$RESULTS"
FAILED=0
CURRENT=""

pass() { printf '  \033[32mPASS\033[0m %s — %s\n' "$CURRENT" "$1"; printf '%s\tPASS\t%s\n' "$CURRENT" "$1" >>"$RESULTS"; }
fail() { printf '  \033[31mFAIL\033[0m %s — %s\n' "$CURRENT" "$1"; printf '%s\tFAIL\t%s\n' "$CURRENT" "$1" >>"$RESULTS"; FAILED=$((FAILED + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

wait_until() { # wait_until <seconds> <condition>
  local deadline=$((SECONDS + $1))
  while ((SECONDS < deadline)); do eval "$2" && return 0; sleep 3; done
  return 1
}

# Claim the instance and sign in as its owner. Cookie jar: $LOGS/cookies.
# Usage: claim_instance <api-base> <origin> <setup-token> <storage-root>
claim_instance() {
  local base="$1" origin="$2" token="$3" storage="$4" code
  : >"$LOGS/cookies"
  code="$(curl -s -o "$LOGS/claim.json" -w '%{http_code}' -c "$LOGS/cookies" -b "$LOGS/cookies" \
    -H 'content-type: application/json' -H "origin: ${origin}" \
    -X POST "${base}/instance/claim" \
    --data-binary @- <<JSON
{"setupToken":"${token}","instanceName":"Scenario","adminName":"Scenario Owner","adminEmail":"owner@example.invalid","adminPassword":"scenario-password-123","storageRoot":"${storage}","libraries":["Videos","Images","Music","Documents"],"acceptedTermsAndPrivacy":true}
JSON
)"
  [[ "$code" == "200" || "$code" == "201" ]] || return 1
  code="$(curl -s -o /dev/null -w '%{http_code}' -c "$LOGS/cookies" -b "$LOGS/cookies" \
    -H 'content-type: application/json' -H "origin: ${origin}" \
    -X POST "${base}/auth/login" \
    --data-binary '{"email":"owner@example.invalid","password":"scenario-password-123"}')"
  [[ "$code" == "200" ]]
}

# POST /license/activate as the signed-in owner. Prints the JSON body.
activate_license() {
  local base="$1" origin="$2" key="$3"
  curl -s -w '\nHTTP %{http_code}\n' -b "$LOGS/cookies" -H 'content-type: application/json' -H "origin: ${origin}" \
    -X POST "${base}/license/activate" --data-binary "{\"licenseKey\":\"${key}\"}"
}

finish() {
  echo ""
  echo "Results: $(grep -c PASS "$RESULTS") passed, ${FAILED} failed  (logs: ${LOGS})"
  [[ "$FAILED" == "0" ]]
}
