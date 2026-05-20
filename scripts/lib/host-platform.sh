# Shared host detection for install.sh and docker-setup.sh
# shellcheck shell=bash

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
    echo "${PRETTY_NAME:-Linux}"
    return
  fi
  echo "Linux"
}
