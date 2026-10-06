#!/usr/bin/env bash
#
#   Arciin — one-line installer                         https://arciin.com
#
#     curl -fsSL https://get.arciin.com/install.sh | bash
#     curl -fsSL https://get.arciin.com/install.sh | bash -s -- --repair
#
#   A thin bootstrapper. It reads the release manifest (stable.json) from the
#   latest GitHub release, downloads the canonical Docker installer it names,
#   checks every file against the manifest's SHA-256, and runs it. All logic —
#   state detection, credential recovery, backups, pinned images — lives in
#   docker-install.sh, the same script a checkout runs.
#
#   Options pass through (see --help): --repair, --fresh, --uninstall,
#   --delete-data, --delete-storage, --dir, --data-dir, --port, --version.
#   Environment: ARCIIN_VERSION=X.Y.Z pins a release; ARCIIN_DIR,
#   ARCIIN_HOST_DATA_DIR, ARCIIN_HTTP_PORT, ARCIIN_ASSUME_YES work as before.
#
set -Eeuo pipefail

REPO="${ARCIIN_REPO:-Roberadesissaii-arc/arciin}"
VERSION="${ARCIIN_VERSION:-${ARCIIN_IMAGE_TAG:-}}"
VERSION="${VERSION#v}"
[[ "$VERSION" == "latest" ]] && VERSION=""

die() { printf '\n  \033[31m✖\033[0m %s\n\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required."
command -v sha256sum >/dev/null 2>&1 || die "sha256sum (coreutils) is required."

if [[ -n "${ARCIIN_MANIFEST_URL:-}" ]]; then
  manifest_url="$ARCIIN_MANIFEST_URL"
elif [[ -n "$VERSION" ]]; then
  manifest_url="https://github.com/${REPO}/releases/download/v${VERSION}/stable.json"
else
  manifest_url="https://github.com/${REPO}/releases/latest/download/stable.json"
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/arciin-install.XXXXXX")"
trap 'rm -rf "$work"' EXIT

curl -fsSL --retry 3 "$manifest_url" -o "$work/stable.json" \
  || die "Could not download the release manifest from ${manifest_url}. Check internet access to github.com. Nothing was changed."

get() { sed -n "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}[[:space:]]*$/\1/p" "$work/stable.json" | head -1; }

[[ "$(get schema)" == "2" ]] || die "The manifest at ${manifest_url} predates v1.1.4. Install v1.1.4 or later (ARCIIN_VERSION=1.1.4). Nothing was changed."
base="$(get assets_base)"

for name in docker-install.sh install-state.sh; do
  curl -fsSL --retry 3 "${base%/}/${name}" -o "$work/$name" \
    || die "Could not download ${name}. Nothing was changed."
  expected="$(get "sha256_${name//[.-]/_}")"
  actual="$(sha256sum "$work/$name" | awk '{print $1}')"
  [[ -n "$expected" && "$expected" == "$actual" ]] \
    || die "${name} failed its checksum (expected ${expected:-none}, got ${actual}). Refusing to run it. Nothing was changed."
done

export ARCIIN_MANIFEST="$work/stable.json"
# Not exec: the trap must clean up the download afterwards.
# stdin is this script when piped from curl; prompts read /dev/tty instead.
bash "$work/docker-install.sh" "$@" </dev/null
