# Shared host detection for install.sh and docker-setup.sh
# shellcheck shell=bash

# True when running inside Windows Subsystem for Linux.
#
# WSL matters because two things a normal Linux host provides are missing:
# systemd is off unless the user opts in, and the distro itself does not start
# when Windows boots. Anything that promises "starts on boot" has to say
# otherwise here.
is_wsl() {
  [[ -n "${WSL_DISTRO_NAME:-}" ]] && return 0
  grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null
}

# True only when systemd is actually the init system and running.
#
# `command -v systemctl` is not enough: on WSL the binary is installed while
# systemd is off, so the check passes and every systemctl call then fails.
has_systemd() {
  command -v systemctl >/dev/null 2>&1 || return 1
  [[ -d /run/systemd/system ]] || return 1
  # "degraded"/"starting" still mean systemd is managing services.
  systemctl is-system-running >/dev/null 2>&1 || \
    [[ "$(systemctl is-system-running 2>/dev/null)" =~ ^(degraded|starting|maintenance)$ ]]
}

# Prints a short label for the current machine (OS or hardware name).
host_display_name() {
  local model
  if [[ -f /proc/device-tree/model ]]; then
    model="$(tr -d '\0' </proc/device-tree/model 2>/dev/null | head -c 120)"
    if [[ -n "$model" ]]; then
      echo "$model"
      return
    fi
  fi
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    if is_wsl; then
      echo "${PRETTY_NAME:-Linux} (WSL)"
    else
      echo "${PRETTY_NAME:-Linux}"
    fi
    return
  fi
  is_wsl && { echo "Linux (WSL)"; return; }
  echo "Linux"
}
