# Shared Arciin storage path defaults (source from install.sh / docker-setup.sh).
#
# Media and libraries live OUTSIDE the git clone so updates/removals of the app
# folder do not delete user files.

# Recommended persistent location on Linux hosts (Docker bind mount + native install).
ARCIIN_DEFAULT_STORAGE="/srv/arciin-storage/arciin"

# Dev-only: inside the repo for quick local experiments (not used by default).
ARCIIN_DEV_STORAGE_REL="./data/arciin"

_arciin_storage_msg() {
  printf '  → %s\n' "$*" >&2
}

_arciin_can_use_storage_path() {
  local path="$1"
  if [[ -d "$path" ]] && [[ -w "$path" ]]; then
    return 0
  fi
  local parent
  parent="$(dirname "$path")"
  [[ -d "$parent" ]] && [[ -w "$parent" ]]
}

_arciin_abs_path() {
  local path="$1"
  if [[ -d "$path" ]]; then
    cd "$path" && pwd
    return 0
  fi
  echo ""
  return 1
}

# Create or validate a storage directory; prints absolute path on success.
_arciin_resolve_storage_dir() {
  local path="$1"
  local repo_root="${2:-}"

  if [[ -z "$path" ]]; then
    path="$ARCIIN_DEFAULT_STORAGE"
  fi

  if [[ "$path" != /* ]]; then
    if [[ -n "$repo_root" ]]; then
      local resolved
      resolved="$(cd "${repo_root}" && mkdir -p "$path" && cd "$path" && pwd)" || true
      if [[ -n "${resolved:-}" ]]; then
        echo "$resolved"
        return 0
      fi
    fi
    echo ""
    return 1
  fi

  if [[ -d "$path" ]]; then
    if [[ ! -w "$path" ]]; then
      echo ""
      return 1
    fi
    cd "$path" && pwd
    return 0
  fi

  local parent
  parent="$(dirname "$path")"
  if [[ ! -d "$parent" ]]; then
    if ! mkdir -p "$parent" 2>/dev/null; then
      if command -v sudo &>/dev/null; then
        sudo mkdir -p "$parent" 2>/dev/null || true
      fi
    fi
  fi

  if mkdir -p "$path" 2>/dev/null; then
    cd "$path" && pwd
    return 0
  fi

  if command -v sudo &>/dev/null; then
    if sudo mkdir -p "$path" && sudo chown -R "$(id -u):$(id -g)" "$path"; then
      cd "$path" && pwd
      return 0
    fi
  fi

  echo ""
  return 1
}

_arciin_list_storage_candidates() {
  local repo_root="${1:-}"
  local path

  echo "$ARCIIN_DEFAULT_STORAGE"

  for path in \
    /mnt/*/arciin-data /mnt/*/arciin \
    /media/*/*/arciin-data /media/*/*/arciin \
    /run/media/*/*/arciin-data /run/media/*/*/arciin; do
    [[ "$path" == *"*"* ]] && continue
    _arciin_can_use_storage_path "$path" && echo "$path"
  done

  if command -v lsblk &>/dev/null; then
    while IFS= read -r mp; do
      [[ -z "$mp" || "$mp" == "/" ]] && continue
      [[ "$mp" == /boot* ]] && continue
      local candidate="${mp%/}/arciin"
      _arciin_can_use_storage_path "$candidate" && echo "$candidate"
    done < <(lsblk -rno MOUNTPOINT 2>/dev/null | sort -u)
  fi

  if [[ -n "$repo_root" ]]; then
    local in_repo="${repo_root}/data/arciin"
    _arciin_can_use_storage_path "$in_repo" && echo "$in_repo"
  fi
}

_arciin_storage_choice_hint() {
  local path="$1"
  local repo_root="${2:-}"
  if [[ "$path" == "$ARCIIN_DEFAULT_STORAGE" ]] || [[ "$path" == /srv/arciin-storage/* ]]; then
    echo " (recommended — outside the app folder)"
  elif [[ -n "$repo_root" ]] && [[ "$path" == "${repo_root}"/* ]]; then
    echo " (inside project — dev only)"
  elif [[ "$path" == /media/* ]]; then
    echo " (external drive)"
  elif [[ "$path" == /mnt/* ]]; then
    echo " (mounted drive)"
  fi
}

# Optional SSD / large disk guidance (install.sh only — never auto-format without consent).
_arciin_prompt_attach_storage_disk() {
  if [[ ! -t 0 ]] || ! command -v lsblk &>/dev/null; then
    return 0
  fi

  local line name size type mount fstype
  local -a unmounted=()
  while read -r name size type mount fstype; do
    [[ "$type" == "disk" || "$type" == "part" ]] || continue
    [[ -n "$mount" ]] && continue
    [[ "$name" == loop* ]] && continue
    [[ "${size%G}" != "$size" && "${size%G}" -lt 8 ]] 2>/dev/null && continue
    unmounted+=("${name} ${size} ${fstype:-unknown}")
  done < <(lsblk -rno NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE 2>/dev/null)

  if [[ "${#unmounted[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "" >&2
  echo "  Detected block device(s) not mounted (possible USB/SATA SSD):" >&2
  local entry
  for entry in "${unmounted[@]}"; do
    echo "    • /dev/${entry%% *} — ${entry#* }" >&2
  done
  echo "" >&2
  echo "  Arciin will NOT format disks from the web UI." >&2
  read -r -p "  Mount a disk now with sudo (guided, no format)? [y/N]: " mount_now
  if [[ ! "$mount_now" =~ ^[Yy] ]]; then
    read -r -p "  Show example commands to format/mount yourself? [y/N]: " show_cmds
    if [[ "$show_cmds" =~ ^[Yy] ]]; then
      echo "" >&2
      echo "  Example (replace sdX1 with your partition — WRONG DEVICE ERASES DATA):" >&2
      echo "    sudo mkdir -p /mnt/arciin-ssd" >&2
      echo "    sudo mkfs.ext4 -L arciin-data /dev/sdX1    # only if the disk is empty" >&2
      echo "    echo '/dev/sdX1 /mnt/arciin-ssd ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab" >&2
      echo "    sudo mount -a" >&2
      echo "    # Then pick /mnt/arciin-ssd/arciin in the installer or setup UI." >&2
      echo "" >&2
    fi
    return 0
  fi

  read -r -p "  Mount point [/mnt/arciin-ssd]: " mp
  mp="${mp:-/mnt/arciin-ssd}"
  read -r -p "  Device to mount (e.g. sdb1): " dev
  dev="${dev#/dev/}"
  [[ -n "$dev" ]] || {
    _arciin_storage_msg "Skipped — no device entered."
    return 0
  }
  if [[ ! -b "/dev/${dev}" ]]; then
    _arciin_storage_msg "/dev/${dev} not found — skipped."
    return 0
  fi
  read -r -p "  Format /dev/${dev} first? THIS ERASES THE DISK [y/N]: " do_fmt
  if [[ "$do_fmt" =~ ^[Yy] ]]; then
    read -r -p "  Type FORMAT ${dev} to confirm: " confirm
    if [[ "$confirm" == "FORMAT ${dev}" ]]; then
      sudo mkfs.ext4 -F -L arciin-data "/dev/${dev}" || {
        _arciin_storage_msg "mkfs failed."
        return 0
      }
    else
      _arciin_storage_msg "Format cancelled."
      return 0
    fi
  fi
  sudo mkdir -p "$mp" || return 0
  if ! grep -q "[[:space:]]${mp}[[:space:]]" /etc/fstab 2>/dev/null; then
    echo "/dev/${dev} ${mp} ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab >/dev/null
  fi
  sudo mount "$mp" 2>/dev/null || sudo mount "/dev/${dev}" "$mp" || {
    _arciin_storage_msg "Mount failed — use lsblk and mount manually."
    return 0
  }
  sudo chown -R "$(id -u):$(id -g)" "$mp" 2>/dev/null || true
  _arciin_storage_msg "Mounted at ${mp} — it will appear in the storage list."
}

# Interactive menu; prints chosen path to stdout. Uses preset when non-interactive.
_arciin_prompt_storage_path() {
  local repo_root="${1:-}"
  local preset="${2:-}"

  if [[ -n "$preset" ]]; then
    echo "$preset"
    return 0
  fi

  if [[ ! -t 0 ]]; then
    echo "$ARCIIN_DEFAULT_STORAGE"
    return 0
  fi

  _arciin_prompt_attach_storage_disk

  echo "" >&2
  echo "  Where should Arciin store your files?" >&2
  echo "  This folder stays on your disk when you update or remove the app." >&2
  echo "" >&2

  mapfile -t CANDIDATES < <(_arciin_list_storage_candidates "$repo_root" | awk '!seen[$0]++' | head -8)
  if [[ "${#CANDIDATES[@]}" -eq 0 ]]; then
    CANDIDATES=("$ARCIIN_DEFAULT_STORAGE")
  fi

  local n=1 c
  for c in "${CANDIDATES[@]}"; do
    echo "    ${n}) ${c}$(_arciin_storage_choice_hint "$c" "$repo_root")" >&2
    n=$((n + 1))
  done
  echo "    ${n}) Enter a custom path" >&2
  echo "" >&2

  local choice
  read -r -p "  Choice [1]: " choice
  choice="${choice:-1}"

  if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 ]] && [[ "$choice" -le "${#CANDIDATES[@]}" ]]; then
    echo "${CANDIDATES[$((choice - 1))]}"
    return 0
  fi

  local custom
  read -r -p "  Full path: " custom
  [[ -n "$custom" ]] || custom="$ARCIIN_DEFAULT_STORAGE"
  echo "$custom"
}

_arciin_storage_has_user_data() {
  local dir="$1"
  local sub
  [[ -d "$dir" ]] || return 1
  for sub in objects libraries thumbnails avatars temp; do
    if [[ -d "${dir}/${sub}" ]] && [[ -n "$(find "${dir}/${sub}" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
      return 0
    fi
  done
  return 1
}

_arciin_collect_legacy_storage_sources() {
  local repo_root="${1:-}"
  local target_abs="${2:-}"
  local env_file="${3:-}"

  if [[ -n "$repo_root" ]]; then
    local in_repo="${repo_root}/data/arciin"
    if [[ -d "$in_repo" ]]; then
      local abs
      abs="$(_arciin_abs_path "$in_repo")" || true
      if [[ -n "$abs" ]] && [[ "$abs" != "$target_abs" ]]; then
        echo "$abs"
      fi
    fi
  fi

  if [[ -f "$env_file" ]]; then
    local key val abs
    for key in ARCIIN_DATA_DIR ARCIIN_HOST_DATA_DIR; do
      val="$(grep "^${key}=" "$env_file" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
      [[ -n "$val" ]] || continue
      if [[ "$val" == ./* ]] && [[ -n "$repo_root" ]]; then
        val="$(cd "$repo_root" && cd "$(dirname "$val")" 2>/dev/null && pwd)/$(basename "$val")" 2>/dev/null || val="${repo_root}/${val#./}"
      fi
      abs="$(_arciin_abs_path "$val" 2>/dev/null)" || true
      if [[ -n "$abs" ]] && [[ "$abs" != "$target_abs" ]]; then
        echo "$abs"
      fi
    done
  fi
}

# Copy data from legacy locations into target when target is empty.
_arciin_migrate_legacy_storage() {
  local target="$1"
  local repo_root="${2:-}"
  local env_file="${3:-}"
  local target_abs src_abs

  target_abs="$(_arciin_abs_path "$target")" || return 0
  if _arciin_storage_has_user_data "$target_abs"; then
    return 0
  fi

  mapfile -t SOURCES < <(_arciin_collect_legacy_storage_sources "$repo_root" "$target_abs" "$env_file" | awk '!seen[$0]++')
  local src
  for src in "${SOURCES[@]}"; do
    [[ -d "$src" ]] || continue
    src_abs="$(_arciin_abs_path "$src")" || continue
    [[ "$src_abs" == "$target_abs" ]] && continue
    if ! _arciin_storage_has_user_data "$src_abs"; then
      continue
    fi

    _arciin_storage_msg "Found existing files at ${src_abs}"
    _arciin_storage_msg "Copying to ${target_abs} (one-time migration)…"

    mkdir -p "$target_abs"
    if command -v rsync &>/dev/null; then
      if rsync -a "${src_abs}/" "${target_abs}/"; then
        _arciin_storage_msg "Migration finished."
        return 0
      fi
    fi
    if cp -a "${src_abs}/." "${target_abs}/" 2>/dev/null; then
      _arciin_storage_msg "Migration finished."
      return 0
    fi
    _arciin_storage_msg "Warning: could not copy from ${src_abs} — check permissions."
  done
  return 0
}

_arciin_prepare_storage_subdirs() {
  local host_dir="$1"
  mkdir -p \
    "${host_dir}/objects" \
    "${host_dir}/libraries" \
    "${host_dir}/thumbnails" \
    "${host_dir}/temp" \
    "${host_dir}/logs" \
    "${host_dir}/avatars" 2>/dev/null \
    || sudo mkdir -p \
      "${host_dir}/objects" \
      "${host_dir}/libraries" \
      "${host_dir}/thumbnails" \
      "${host_dir}/temp" \
      "${host_dir}/logs" \
      "${host_dir}/avatars"
}

_arciin_docker_chown_for_api() {
  local host_dir="$1"
  if [[ "$(stat -c '%u' "$host_dir" 2>/dev/null || echo 0)" != "1000" ]]; then
    if command -v sudo &>/dev/null && [[ "$(id -u)" -ne 1000 ]]; then
      sudo chown -R 1000:1000 "$host_dir" 2>/dev/null || true
    fi
  fi
}

# Full host storage setup: choose path, create dirs, migrate legacy data, prepare layout.
# Prints absolute host path on stdout.
_arciin_setup_host_storage() {
  local repo_root="${1:-}"
  local preset="${2:-}"
  local env_file="${3:-}"
  local for_docker="${4:-0}"
  local resolved chosen

  chosen="$(_arciin_prompt_storage_path "$repo_root" "$preset")"
  resolved="$(_arciin_resolve_storage_dir "$chosen" "$repo_root")"
  if [[ -z "$resolved" ]]; then
    if command -v sudo &>/dev/null && [[ -t 0 ]]; then
      _arciin_storage_msg "Permission denied creating ${chosen}"
      read -r -p "  Create ${chosen} with sudo? [y/N]: " use_sudo
      if [[ "$use_sudo" =~ ^[Yy] ]]; then
        if sudo mkdir -p "$chosen" && sudo chown -R "$(id -u):$(id -g)" "$chosen"; then
          resolved="$(_arciin_abs_path "$chosen")"
        fi
      fi
    fi
  fi
  [[ -n "$resolved" ]] || {
    echo "" >&2
    echo "  Could not create storage at ${chosen}." >&2
    echo "  Try: sudo mkdir -p ${ARCIIN_DEFAULT_STORAGE}" >&2
    echo "       sudo chown -R \$(id -un):\$(id -gn) ${ARCIIN_DEFAULT_STORAGE}" >&2
    return 1
  }

  if [[ -n "$repo_root" ]]; then
    local repo_abs resolved_abs
    repo_abs="$(cd "$repo_root" && pwd)" || repo_abs="$repo_root"
    resolved_abs="$(cd "$resolved" && pwd)" || resolved_abs="$resolved"
    if [[ "$resolved_abs" == "$repo_abs" ]]; then
      _arciin_storage_msg "WARNING: Storage is the same folder as the Arciin git clone."
      _arciin_storage_msg "Docker builds will fail or fill the disk unless you use /srv/arciin-storage/arciin (recommended)."
    elif [[ "$resolved_abs" == "${repo_abs}/"* ]]; then
      _arciin_storage_msg "WARNING: Storage is inside the git clone (${resolved_abs})."
      _arciin_storage_msg "Prefer ${ARCIIN_DEFAULT_STORAGE} so updates and docker compose build stay small."
    fi
  fi

  _arciin_migrate_legacy_storage "$resolved" "$repo_root" "$env_file"
  _arciin_prepare_storage_subdirs "$resolved"
  if [[ "$for_docker" == "1" ]]; then
    _arciin_docker_chown_for_api "$resolved"
  fi

  echo "$resolved"
}
