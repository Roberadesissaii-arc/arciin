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

  for path in /mnt/*/arciin-data /media/*/*/arciin-data; do
    [[ "$path" == *"*"* ]] && continue
    _arciin_can_use_storage_path "$path" && echo "$path"
  done

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

  _arciin_migrate_legacy_storage "$resolved" "$repo_root" "$env_file"
  _arciin_prepare_storage_subdirs "$resolved"
  if [[ "$for_docker" == "1" ]]; then
    _arciin_docker_chown_for_api "$resolved"
  fi

  echo "$resolved"
}
