# Shared helpers: keep Docker build context small when media lives in the git clone.
# shellcheck shell=bash

# Dirs that must not be sent to `docker build` (runtime storage, not app source).
_ARCIIN_DOCKER_STASH_DIRS=(data objects libraries thumbnails temp avatars logs)

_arciin_dir_size_mb() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    echo 0
    return
  fi
  du -sm "$path" 2>/dev/null | awk '{print $1+0}'
}

# Warn when large folders still live inside the repository.
arciin_docker_warn_repo_media() {
  local root="$1" host_data="${2:-}" found=() path mb

  for dir in "${_ARCIIN_DOCKER_STASH_DIRS[@]}"; do
    path="${root}/${dir}"
    mb="$(_arciin_dir_size_mb "$path")"
    if (( mb > 50 )); then
      found+=("${dir} (~${mb} MB)")
    fi
  done

  if ((${#found[@]} > 0)); then
    warn "Large folders in the git clone: ${found[*]}"
    warn "Docker builds can fail (disk full / multi‑GB context). Use host storage outside the repo."
    if [[ -n "$host_data" ]]; then
      warn "Configured host path: ${host_data}"
      warn "After files are on that path, you can remove ${root}/data from the clone."
    fi
    warn "Free Docker disk: docker builder prune -af"
  fi
}

arciin_docker_stash_repo_media() {
  # `root` is declared on its own line on purpose. Bash expands every word of a
  # `local` before applying any of its assignments, so a second variable on the
  # same line that referenced ${root} read it as unset — and under `set -u` that
  # aborted the build. `pnpm docker:build` failed on its first line with
  # "root: unbound variable" and never reached a docker command.
  local root="$1"
  local stash="${root}/.arciin-docker-build-stash-$$"
  local moved=() path mb

  mkdir -p "$stash"
  for dir in "${_ARCIIN_DOCKER_STASH_DIRS[@]}"; do
    path="${root}/${dir}"
    [[ -e "$path" ]] || continue
    mb="$(_arciin_dir_size_mb "$path")"
    mv "$path" "${stash}/${dir}"
    if (( mb > 0 )); then
      moved+=("${dir} (~${mb} MB)")
    else
      moved+=("${dir}")
    fi
  done

  if ((${#moved[@]} > 0)); then
    export ARCIIN_DOCKER_BUILD_STASH="$stash"
    warn "Moved aside for Docker build (restored after): ${moved[*]}"
    return 0
  fi

  rmdir "$stash" 2>/dev/null || true
  return 1
}

arciin_docker_restore_repo_media() {
  local root="$1" stash="${ARCIIN_DOCKER_BUILD_STASH:-}"
  [[ -n "$stash" && -d "$stash" ]] || return 0

  for dir in "${_ARCIIN_DOCKER_STASH_DIRS[@]}"; do
    if [[ -e "${stash}/${dir}" ]]; then
      if [[ -e "${root}/${dir}" ]]; then
        warn "Cannot restore ${dir}/ — ${root}/${dir} already exists; left in ${stash}"
      else
        mv "${stash}/${dir}" "${root}/${dir}"
      fi
    fi
  done
  rmdir "$stash" 2>/dev/null || true
  unset ARCIIN_DOCKER_BUILD_STASH
}
