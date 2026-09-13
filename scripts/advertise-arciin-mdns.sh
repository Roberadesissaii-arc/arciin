#!/usr/bin/env bash
# Persistent LAN advertisement for Arciin Desktop clients.
#
# This is a host-side helper. It must never be required for Arciin to start.
# Manual IP / domain connection always works without mDNS.
#
# Installers call the same logic automatically on Debian/Ubuntu. Re-run this
# after the customer-facing HTTP port changes so the advertised port stays current:
#
#   bash scripts/advertise-arciin-mdns.sh [port]
#
# Docker:
#   pass ARCIIN_HTTP_PORT (default 80)
# Native:
#   pass the configured web port (ARCIIN_WEB_PORT)
#
# Docker bridged networking does not reliably propagate multicast. Run this
# on the host, not inside the API container.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/host-platform.sh
source "${ROOT_DIR}/scripts/lib/host-platform.sh"
# shellcheck source=scripts/lib/avahi-discovery.sh
source "${ROOT_DIR}/scripts/lib/avahi-discovery.sh"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  # Best-effort port defaults from the instance env. Never source secrets into logs.
  _mdns_env_val() {
    grep -E "^${1}=" "${ROOT_DIR}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
  }
  : "${ARCIIN_HTTP_PORT:=$(_mdns_env_val ARCIIN_HTTP_PORT)}"
  : "${ARCIIN_WEB_PORT:=$(_mdns_env_val ARCIIN_WEB_PORT)}"
  : "${PORT:=$(_mdns_env_val PORT)}"
fi

arciin_setup_persistent_mdns "${1:-}"
