#!/usr/bin/env bash
# ================================================================
#  Open Arciin firewall ports on this host (safe re-run anytime).
#
#  Usage:
#    ./scripts/open-firewall.sh
#    ./scripts/open-firewall.sh 80 3000 4000 3010 4100
#    ARCIIN_OPEN_PLATFORM_PORTS=0 ./scripts/open-firewall.sh
# ================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/open-firewall-ports.sh
source "${ROOT_DIR}/scripts/lib/open-firewall-ports.sh"

ENV_FILE="${ROOT_DIR}/.env"
if [[ ! -f "$ENV_FILE" && -f /srv/arciin/.env ]]; then
  ENV_FILE=/srv/arciin/.env
fi

if [[ $# -gt 0 ]]; then
  arciin_open_firewall_ports "$@"
  exit 0
fi

mapfile -t ports < <(arciin_collect_standard_ports "$ENV_FILE")
arciin_open_firewall_ports "${ports[@]}"
