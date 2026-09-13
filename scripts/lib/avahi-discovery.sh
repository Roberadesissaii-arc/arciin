# Shared host-side mDNS / Avahi helpers for install.sh and docker-setup.sh.
# shellcheck shell=bash
#
# Convenience only. Every function must fail open: never abort an installer.
# Manual IP / domain connection always remains the supported fallback.
#
# Advertisement belongs on the HOST. Do not run this inside a bridged container
# and do not switch Docker to host networking.

ARCIIN_AVAHI_SERVICE_PATH="${ARCIIN_AVAHI_SERVICE_PATH:-/etc/avahi/services/arciin.service}"
ARCIIN_MDNS_SERVICE_TYPE="${ARCIIN_MDNS_SERVICE_TYPE:-_arciin._tcp}"
ARCIIN_MDNS_PROTOCOL="${ARCIIN_DEVICE_PROTOCOL_VERSION:-1}"
ARCIIN_MDNS_PATH="${ARCIIN_DISCOVERY_PATH:-/.well-known/arciin}"

_arciin_mdns_ok() {
  if declare -F ok >/dev/null 2>&1; then
    ok "$1"
  else
    echo "  ✔  $1"
  fi
}

_arciin_mdns_warn() {
  if declare -F warn >/dev/null 2>&1; then
    warn "$1"
  else
    echo "  ⚠  $1"
  fi
}

arciin_mdns_is_debian_family() {
  [[ -f /etc/os-release ]] || return 1
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu|linuxmint|pop|elementary|raspbian) return 0 ;;
  esac
  case "${ID_LIKE:-}" in
    *debian*|*ubuntu*) return 0 ;;
  esac
  return 1
}

# True when we can run privileged commands without turning install into a prompt loop.
arciin_mdns_can_privilege() {
  [[ "${EUID}" -eq 0 ]] && return 0
  command -v sudo >/dev/null 2>&1 || return 1
  sudo -n true >/dev/null 2>&1 && return 0
  # Cached sudo from an installer that already called require_sudo_credentials.
  sudo -n true >/dev/null 2>&1 || sudo -v >/dev/null 2>&1
}

arciin_mdns_run() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Refuse API listen ports so discovery never points at Fastify :4000.
arciin_mdns_sanitize_port() {
  local port="${1:-}"
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  if ((port < 1 || port > 65535)); then
    return 1
  fi
  if [[ "$port" == "4000" || "$port" == "4001" ]]; then
    return 1
  fi
  printf '%s' "$port"
}

# Resolve the customer-facing HTTP port when the caller did not pass one.
# Docker: ARCIIN_HTTP_PORT (default 80). Native: ARCIIN_WEB_PORT / PORT.
arciin_mdns_resolve_port() {
  local requested="${1:-}" sanitized
  if [[ -n "$requested" ]]; then
    sanitized="$(arciin_mdns_sanitize_port "$requested")" || return 1
    printf '%s' "$sanitized"
    return 0
  fi

  if [[ -n "${ARCIIN_HTTP_PORT:-}" ]]; then
    sanitized="$(arciin_mdns_sanitize_port "${ARCIIN_HTTP_PORT}")" && {
      printf '%s' "$sanitized"
      return 0
    }
  fi

  if [[ -n "${ARCIIN_WEB_PORT:-}" ]]; then
    sanitized="$(arciin_mdns_sanitize_port "${ARCIIN_WEB_PORT}")" && {
      printf '%s' "$sanitized"
      return 0
    }
  fi

  if [[ -n "${PORT:-}" ]]; then
    sanitized="$(arciin_mdns_sanitize_port "${PORT}")" && {
      printf '%s' "$sanitized"
      return 0
    }
  fi

  return 1
}

arciin_mdns_service_xml() {
  local port="$1"
  cat <<EOF
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Arciin on %h</name>
  <service>
    <type>${ARCIIN_MDNS_SERVICE_TYPE}</type>
    <port>${port}</port>
    <txt-record>protocol=${ARCIIN_MDNS_PROTOCOL}</txt-record>
    <txt-record>path=${ARCIIN_MDNS_PATH}</txt-record>
  </service>
</service-group>
EOF
}

arciin_mdns_xml_is_safe() {
  local xml="$1"
  case "$xml" in
    *email*|*password*|*storageRoot*|*license*|*DATABASE*|*REDIS*|*setupToken*|*SESSION*)
      return 1
      ;;
  esac
  return 0
}

_arciin_mdns_write_file() {
  local dest="$1" contents="$2" tmp
  tmp="$(mktemp)" || return 1
  printf '%s\n' "$contents" >"$tmp"
  if [[ "$dest" == /etc/* ]]; then
    arciin_mdns_run mkdir -p "$(dirname "$dest")" || { rm -f "$tmp"; return 1; }
    arciin_mdns_run cp "$tmp" "$dest" || { rm -f "$tmp"; return 1; }
    arciin_mdns_run chmod 644 "$dest" || true
  else
    mkdir -p "$(dirname "$dest")" || { rm -f "$tmp"; return 1; }
    cp "$tmp" "$dest" || { rm -f "$tmp"; return 1; }
    chmod 644 "$dest" || true
  fi
  rm -f "$tmp"
  return 0
}

_arciin_mdns_install_packages() {
  command -v avahi-publish-service >/dev/null 2>&1 && command -v avahi-daemon >/dev/null 2>&1 && return 0
  command -v apt-get >/dev/null 2>&1 || return 1
  arciin_mdns_is_debian_family || return 1
  arciin_mdns_can_privilege || return 1
  arciin_mdns_run apt-get update -qq >/dev/null 2>&1 || true
  arciin_mdns_run apt-get install -y -qq avahi-daemon avahi-utils
}

_arciin_mdns_enable_daemon() {
  if declare -F has_systemd >/dev/null 2>&1 && ! has_systemd; then
    _arciin_mdns_warn "systemd is not active — Avahi cannot persist across reboot here"
    return 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    return 1
  fi
  arciin_mdns_run systemctl enable avahi-daemon >/dev/null 2>&1 || return 1
  arciin_mdns_run systemctl start avahi-daemon >/dev/null 2>&1 || return 1
  arciin_mdns_run systemctl reload avahi-daemon >/dev/null 2>&1 \
    || arciin_mdns_run systemctl restart avahi-daemon >/dev/null 2>&1 \
    || true
  return 0
}

_arciin_mdns_open_multicast() {
  [[ "${ARCIIN_SKIP_FIREWALL:-0}" == "1" ]] && return 0
  command -v sudo >/dev/null 2>&1 || [[ "${EUID}" -eq 0 ]] || return 0
  if command -v ufw >/dev/null 2>&1; then
    arciin_mdns_run ufw allow 5353/udp comment "Arciin mDNS" >/dev/null 2>&1 || true
  fi
}

# Install Avahi when possible, write /etc/avahi/services/arciin.service, enable
# the daemon. Always returns 0. Safe to re-run after a port change.
arciin_setup_persistent_mdns() {
  local port xml dest

  if [[ "${ARCIIN_SKIP_MDNS:-0}" == "1" ]]; then
    _arciin_mdns_warn "Skipping LAN discovery (ARCIIN_SKIP_MDNS=1). Manual IP still works."
    return 0
  fi

  port="$(arciin_mdns_resolve_port "${1:-}")" || {
    _arciin_mdns_warn "Could not resolve a customer-facing web port for LAN discovery. Manual IP still works."
    return 0
  }

  dest="${ARCIIN_AVAHI_SERVICE_PATH}"
  xml="$(arciin_mdns_service_xml "$port")"
  if ! arciin_mdns_xml_is_safe "$xml"; then
    _arciin_mdns_warn "Refusing to advertise extra metadata over mDNS. Manual IP still works."
    return 0
  fi

  if [[ "${ARCIIN_MDNS_DRY_RUN:-0}" == "1" ]]; then
    _arciin_mdns_write_file "$dest" "$xml" || true
    _arciin_mdns_ok "Dry-run wrote mDNS service definition for port ${port}"
    return 0
  fi

  if ! command -v avahi-daemon >/dev/null 2>&1 || ! command -v avahi-publish-service >/dev/null 2>&1; then
    if ! _arciin_mdns_install_packages; then
      _arciin_mdns_warn "Avahi is not installed. LAN discovery was skipped. Connect with the server IP or domain."
      return 0
    fi
    _arciin_mdns_ok "Installed avahi-daemon and avahi-utils"
  fi

  if [[ "$dest" == /etc/* ]] && ! arciin_mdns_can_privilege; then
    _arciin_mdns_warn "Need sudo to write ${dest}. LAN discovery was skipped. Manual IP still works."
    return 0
  fi

  if ! _arciin_mdns_write_file "$dest" "$xml"; then
    _arciin_mdns_warn "Could not write ${dest}. Manual IP still works."
    return 0
  fi
  _arciin_mdns_ok "Persistent mDNS service: ${ARCIIN_MDNS_SERVICE_TYPE} port ${port}"

  _arciin_mdns_open_multicast || true

  if _arciin_mdns_enable_daemon; then
    _arciin_mdns_ok "avahi-daemon enabled (survives reboot)"
  else
    _arciin_mdns_warn "Avahi service file is in place, but the daemon is not enabled. Manual IP still works."
  fi

  return 0
}

# Alias for port changes: rewrite the definition and reload Avahi.
arciin_refresh_mdns_advertisement() {
  arciin_setup_persistent_mdns "$@"
}
