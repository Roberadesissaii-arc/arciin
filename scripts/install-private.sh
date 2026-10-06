#!/usr/bin/env bash
# ================================================================
#  Retired in v1.1.4 — kept so old instructions still work.
#
#  The prototype "private distribution" installer is replaced by the one
#  canonical Docker installer, scripts/docker-install.sh. An existing
#  install under ARCIIN_INSTALL_DIR (default /srv/arciin) is adopted in place:
#  same Compose project, same volumes, same .env.
# ================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
legacy_dir="${ARCIIN_INSTALL_DIR:-/srv/arciin}"
if [[ -z "${ARCIIN_DIR:-}" && -f "$legacy_dir/.env" ]]; then
  export ARCIIN_DIR="$legacy_dir"
fi
echo "  install-private.sh is retired — running the canonical Docker installer." >&2
exec bash "$SCRIPT_DIR/docker-setup.sh" "$@"
