#!/usr/bin/env bash
# Prove what the public licensing perimeter does and does not expose.
#
#   scripts/verify-license-perimeter.sh https://license.example.com
#   scripts/verify-license-perimeter.sh            # defaults to the local test port
#
# The authority runs on loopback and this proxy is the only thing in front of
# it, so "which paths are reachable" is a security property and belongs in a
# test rather than in a comment. Reads LICENSE_SERVICE_TOKEN from the
# environment when present, to prove that a *correct* credential is still
# accepted; never prints it.
set -uo pipefail

BASE="${1:-http://127.0.0.1:4443}"
TOKEN="${LICENSE_SERVICE_TOKEN:-}"

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($2)"; pass=$((pass+1)); else echo "  FAIL  $1 (got $2, want $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$@"; }
post() { code -X POST -H 'Content-Type: application/json' -d '{}' "$@"; }

echo "== perimeter: $BASE"

echo "-- customer installations reach the authority"
for r in activate refresh deactivate; do
  # 400 means the request arrived and the app rejected an empty body: proxied.
  chk "POST /licenses/$r proxied" "$(post "$BASE/licenses/$r")" "400"
done

echo "-- website service routes fail closed without a credential"
chk "POST /licenses/issue"             "$(post "$BASE/licenses/issue")" "401"
chk "POST /licenses/revoke"            "$(post "$BASE/licenses/revoke")" "401"
chk "POST /account/deactivate-server"  "$(post "$BASE/account/deactivate-server")" "401"
chk "GET  /account/overview"           "$(code "$BASE/account/overview?email=nobody@arciin.invalid")" "401"

echo "-- a wrong credential is refused"
chk "POST /licenses/issue wrong token" \
  "$(code -X POST -H 'Authorization: Bearer definitely-not-the-service-token' -H 'Content-Type: application/json' -d '{}' "$BASE/licenses/issue")" "401"

if [ -n "$TOKEN" ]; then
  echo "-- a correct credential is accepted"
  chk "GET /account/overview with token" \
    "$(code -H "Authorization: Bearer $TOKEN" "$BASE/account/overview?email=nobody@arciin.invalid")" "200"
fi

echo "-- administrative and unused surfaces are not public"
chk "POST /licenses/demo"        "$(post "$BASE/licenses/demo")" "404"
chk "POST /licenses/delete"      "$(post "$BASE/licenses/delete")" "404"
chk "GET  /licenses/status"      "$(code "$BASE/licenses/status?licenseKey=x")" "404"
chk "GET  /licenses/lookup"      "$(code "$BASE/licenses/lookup?licenseKey=x")" "404"
chk "GET  /account/licenses"     "$(code "$BASE/account/licenses")" "404"
chk "GET  /account/activations"  "$(code "$BASE/account/activations")" "404"
chk "GET  / (service banner)"    "$(code "$BASE/")" "404"

echo "-- only the required method is allowed on each path"
chk "GET    /licenses/activate"  "$(code "$BASE/licenses/activate")" "404"
chk "DELETE /licenses/issue"     "$(code -X DELETE "$BASE/licenses/issue")" "404"
chk "PUT    /licenses/refresh"   "$(code -X PUT "$BASE/licenses/refresh")" "404"

echo "-- unknown paths"
chk "GET /nope"                  "$(code "$BASE/nope")" "404"
chk "GET /admin"                 "$(code "$BASE/admin")" "404"

echo "-- oversized bodies are refused before reaching the authority"
big=$(mktemp); python3 -c "print('x'*80000)" > "$big"
chk "POST 80KB body" "$(code -X POST -H 'Content-Type: application/json' --data-binary @"$big" "$BASE/licenses/activate")" "413"
rm -f "$big"

echo
echo "  PERIMETER: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
