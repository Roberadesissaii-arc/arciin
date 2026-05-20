#!/bin/sh
# Install cloudflared binary (Alpine Docker or generic Linux).
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
set -eu

install_url() {
  arch="$1"
  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}"
  dest="${2:-/usr/local/bin/cloudflared}"
  echo "Installing cloudflared (${arch}) -> ${dest}"
  curl -fsSL "$url" -o "$dest"
  chmod +x "$dest"
}

map_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    armv7l|armhf) echo "arm" ;;
    *)
      echo "unsupported: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

if command -v cloudflared >/dev/null 2>&1; then
  cloudflared --version
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache curl ca-certificates
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq curl ca-certificates
  else
    echo "curl is required to install cloudflared" >&2
    exit 1
  fi
fi

cf_arch="$(map_arch)"
install_url "$cf_arch" "${CLOUDFLARED_INSTALL_PATH:-/usr/local/bin/cloudflared}"
cloudflared --version
