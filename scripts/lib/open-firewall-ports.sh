#!/usr/bin/env bash
# ================================================================
#  Open host firewall ports for Arciin (UFW / firewalld / nftables).
#  Safe for new servers: ensures SSH stays allowed before enabling UFW.
#
#  Usage (source, then call):
#    source scripts/lib/open-firewall-ports.sh
#    arciin_open_firewall_ports 80 3000 4000
#    arciin_open_firewall_ports --label "Arciin web" 3000
#
#  Env:
#    ARCIIN_SKIP_FIREWALL=1     — no-op
#    ARCIIN_FIREWALL_FORCE_SSH=1 — always allow 22/tcp before enable (default on)
# ================================================================

arciin_open_firewall_ports() {
  if [[ "${ARCIIN_SKIP_FIREWALL:-0}" == "1" ]]; then
    echo "  ⚠  Skipping firewall (ARCIIN_SKIP_FIREWALL=1)"
    return 0
  fi

  local -a ports=()
  local -a labels=()
  local label="Arciin"
  local p

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --label)
        label="${2:-Arciin}"
        shift 2
        ;;
      ''|*[!0-9]*)
        # skip non-numeric
        shift
        ;;
      *)
        ports+=("$1")
        labels+=("$label")
        shift
        ;;
    esac
  done

  if [[ ${#ports[@]} -eq 0 ]]; then
    return 0
  fi

  # De-dupe ports
  local -a unique=()
  local seen="|"
  for p in "${ports[@]}"; do
    [[ -z "$p" || "$p" == "0" ]] && continue
    if [[ "$seen" != *"|${p}|"* ]]; then
      unique+=("$p")
      seen="${seen}${p}|"
    fi
  done
  ports=("${unique[@]}")
  [[ ${#ports[@]} -eq 0 ]] && return 0

  echo "  → Opening firewall for TCP: ${ports[*]}"

  # Prefer UFW (Ubuntu/Debian)
  if command -v ufw >/dev/null 2>&1 || command -v apt-get >/dev/null 2>&1; then
    if ! command -v ufw >/dev/null 2>&1; then
      if command -v sudo >/dev/null 2>&1; then
        sudo apt-get install -y -qq ufw &>/dev/null || true
      fi
    fi
  fi

  if command -v ufw >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    _arciin_ufw_open_ports "${ports[@]}"
    return $?
  fi

  # firewalld (RHEL/Fedora/CentOS)
  if command -v firewall-cmd >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    if sudo systemctl is-active --quiet firewalld 2>/dev/null \
      || sudo firewall-cmd --state &>/dev/null; then
      for p in "${ports[@]}"; do
        sudo firewall-cmd --permanent --add-port="${p}/tcp" &>/dev/null || true
      done
      sudo firewall-cmd --reload &>/dev/null || true
      echo "  ✔  firewalld: allowed ${ports[*]}/tcp"
      return 0
    fi
  fi

  # nftables / iptables fallback (best-effort)
  if command -v sudo >/dev/null 2>&1; then
    if command -v nft >/dev/null 2>&1; then
      for p in "${ports[@]}"; do
        # Ignore errors if chain layout differs
        sudo nft add rule inet filter input tcp dport "$p" accept 2>/dev/null || true
      done
      echo "  ⚠  nftables: attempted allow for ${ports[*]}/tcp (verify with: sudo nft list ruleset)"
      return 0
    fi
    if command -v iptables >/dev/null 2>&1; then
      for p in "${ports[@]}"; do
        sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null \
          || sudo iptables -I INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || true
      done
      echo "  ⚠  iptables: attempted allow for ${ports[*]}/tcp (rules may not persist across reboot)"
      return 0
    fi
  fi

  echo "  ⚠  No supported firewall tool found — open TCP ${ports[*]} manually"
  return 0
}

_arciin_ufw_open_ports() {
  local ports=("$@")
  local p status

  # Never lock out SSH when enabling UFW on a fresh VPS
  if [[ "${ARCIIN_FIREWALL_FORCE_SSH:-1}" == "1" ]]; then
    sudo ufw allow OpenSSH &>/dev/null \
      || sudo ufw allow 22/tcp comment "SSH" &>/dev/null \
      || true
  fi

  for p in "${ports[@]}"; do
    if sudo ufw allow "${p}/tcp" comment "Arciin port ${p}" &>/dev/null; then
      echo "  ✔  UFW allow ${p}/tcp"
    else
      echo "  ⚠  Could not add UFW rule for ${p}/tcp"
    fi
  done

  status="$(sudo ufw status 2>/dev/null | head -1 || true)"
  if echo "$status" | grep -qi "inactive"; then
    # Enable so LAN/browser access works on a new server
    if echo "y" | sudo ufw --force enable &>/dev/null; then
      echo "  ✔  UFW enabled (was inactive — required for rules to take effect)"
    else
      echo "  ⚠  UFW rules added but could not enable UFW — run: sudo ufw enable"
    fi
  else
    echo "  ✔  UFW is active"
  fi

  # Reload to be safe
  sudo ufw reload &>/dev/null || true

  echo "  ── ufw status (Arciin-related) ──"
  sudo ufw status numbered 2>/dev/null | grep -E "Arciin|${ports[0]}" | sed 's/^/    /' \
    || sudo ufw status 2>/dev/null | head -20 | sed 's/^/    /' || true
}

# Collect standard Arciin ports from env / defaults.
# Customer product: web + API (+ Docker HTTP).
# Optional platform (account + license server): 3010, 4100 when ARCIIN_OPEN_PLATFORM_PORTS=1 (default 1 in monorepo dev).
arciin_collect_standard_ports() {
  local env_file="${1:-}"
  local -a out=()
  local v

  _read_env_port() {
    local key="$1" default="$2" file="$3"
    local val="$default"
    if [[ -n "$file" && -f "$file" ]]; then
      val="$(grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
      [[ -z "$val" ]] && val="$default"
    fi
    # Also allow live env override
    local live="${!key:-}"
    [[ -n "$live" ]] && val="$live"
    echo "$val"
  }

  out+=("$(_read_env_port ARCIIN_WEB_PORT 3000 "$env_file")")
  out+=("$(_read_env_port PORT 3000 "$env_file")")
  out+=("$(_read_env_port API_PORT 4000 "$env_file")")
  out+=("$(_read_env_port ARCIIN_API_PORT 4000 "$env_file")")
  # Docker / Caddy public HTTP
  out+=("$(_read_env_port ARCIIN_HTTP_PORT 80 "$env_file")")

  local mobile
  mobile="$(_read_env_port ARCIIN_MOBILE_PORT "" "$env_file")"
  [[ -n "$mobile" ]] && out+=("$mobile")

  # Account portal + license server (vendor/platform prototype on this host)
  if [[ "${ARCIIN_OPEN_PLATFORM_PORTS:-1}" == "1" ]]; then
    out+=("$(_read_env_port LICENSE_SERVER_PORT 4100 "$env_file")")
    out+=("$(_read_env_port ACCOUNT_PORT 3010 "$env_file")")
    out+=("3010")
    out+=("4100")
  fi

  # Print space-separated
  printf '%s\n' "${out[@]}"
}
