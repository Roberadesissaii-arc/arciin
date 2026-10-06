#!/usr/bin/env bash
# Copy the installer release assets into <dir> under their published names.
# The list must match MANIFEST_ASSETS in scripts/release-manifest.mjs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:?usage: stage-release-assets.sh <dir>}"
mkdir -p "$out"
cp "$ROOT/scripts/install-bootstrap.sh" "$out/install.sh"
cp "$ROOT/scripts/docker-install.sh" "$ROOT/scripts/arciin-doctor.sh" "$out/"
cp "$ROOT/scripts/lib/install-state.sh" "$ROOT/scripts/lib/avahi-discovery.sh" "$out/"
cp "$ROOT/docker-compose.production.yml" "$out/docker-compose.yml"
cp "$ROOT/docker/caddy/Caddyfile" "$out/Caddyfile"
chmod 755 "$out"/*.sh
