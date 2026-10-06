#!/usr/bin/env bash
# Retired in v1.1.4. Release assets (stable.json, docker-compose.yml, Caddyfile,
# the installer scripts and SHA256SUMS) are built
# and published by .github/workflows/release.yml after all three images are
# verified. Install with: curl -fsSL https://get.arciin.com/install.sh | bash
echo "package-private-release.sh is retired: releases are published by .github/workflows/release.yml" >&2
exit 1
