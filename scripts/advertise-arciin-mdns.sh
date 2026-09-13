#!/usr/bin/env bash
# Optional LAN advertisement for future Arciin Desktop clients.
#
# This is a host-side helper. It must never be required for Arciin to start.
# Manual IP / domain connection always works without mDNS.
#
# Typical use on a Linux host with Avahi:
#   bash scripts/advertise-arciin-mdns.sh [port]
#
# Docker bridged networking does not reliably propagate multicast. Run this
# on the host, not inside the API container.

set -euo pipefail

PORT="${1:-80}"
PATH_TXT="${ARCIIN_DISCOVERY_PATH:-/.well-known/arciin}"
PROTOCOL="${ARCIIN_DEVICE_PROTOCOL_VERSION:-1}"

if ! command -v avahi-publish-service >/dev/null 2>&1; then
  echo "avahi-publish-service is not installed. Skipping mDNS advertisement."
  echo "Install avahi-daemon / avahi-utils on the host if you want LAN discovery."
  exit 0
fi

exec avahi-publish-service \
  "Arciin" \
  _arciin._tcp \
  "${PORT}" \
  "protocol=${PROTOCOL}" \
  "path=${PATH_TXT}"
