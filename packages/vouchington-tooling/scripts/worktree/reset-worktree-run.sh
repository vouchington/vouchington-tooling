#!/usr/bin/env bash
# Body and lock supervisor for reset-worktree.sh. Sourced, not executed.

reset_worker=""
RESET_UNDER_LOCKF=false

cancel_reset() {
  local exit_code="$1"
  trap '' INT TERM HUP
  reset_worker="${reset_worker:-${!:-}}"
  if [ -n "$reset_worker" ]; then
    kill -TERM -- "-$reset_worker" 2>/dev/null || true
    local grace_tick=0
    while [ "$grace_tick" -lt 10 ] && kill -0 -- "-$reset_worker" 2>/dev/null; do
      /bin/sleep 0.1
      grace_tick=$((grace_tick + 1))
    done
    kill -KILL -- "-$reset_worker" 2>/dev/null || true
    wait "$reset_worker" 2>/dev/null || true
  fi
  exit "$exit_code"
}

run_reset_supervised() {
  trap 'cancel_reset 130' INT
  trap 'cancel_reset 143' TERM
  trap 'cancel_reset 129' HUP
  set -m
  (
    set +m
    trap '' TTIN TTOU
    export GIT_TERMINAL_PROMPT=0
    "$@"
  ) </dev/null 9>&- &
  reset_worker=$!
  set +m
  wait "$reset_worker"
}

acquire_reset_lock() {
  [ "${WORKTREE_RESET_UNDER_LOCKF:-}" != "$ROOT" ] || RESET_UNDER_LOCKF=true
  mkdir -p "$ROOT/.local"
  if [ "${WORKTREE_RESET_UNDER_LOCKF:-}" = "$ROOT" ]; then
    unset WORKTREE_RESET_UNDER_LOCKF
    return 0
  fi
  if command -v flock >/dev/null 2>&1; then
    exec 9>>"$ROOT/.local/reset-worktree.lock"
    flock -n 9 || { echo "Error: another worktree reset is running for this worktree." >&2; exit 1; }
  elif command -v lockf >/dev/null 2>&1; then
    run_reset_supervised env WORKTREE_RESET_UNDER_LOCKF="$ROOT" lockf -s -k -t 0 \
      "$ROOT/.local/reset-worktree.lock" "$0" "${ORIGINAL_ARGS[@]}" && exit 0
    lockf_status=$?
    if [ "$lockf_status" -eq 75 ]; then
      echo "Error: another worktree reset is running for this worktree." >&2
      exit 1
    fi
    exit "$lockf_status"
  else
    echo "Error: worktree reset requires flock or lockf." >&2
    exit 1
  fi
  unset WORKTREE_RESET_UNDER_LOCKF
}

refuse_dirty() {
  if $FORCE; then
    return 0
  fi
  git -C "$ROOT" update-index -q --refresh >/dev/null 2>&1 || true
  if ! git -C "$ROOT" diff-index --quiet HEAD -- 2>/dev/null; then
    echo "Error: uncommitted changes detected." >&2
    echo "Commit, stash, or discard them first, or rerun with --force to discard." >&2
    exit 1
  fi
  # The reset lock lives in the worktree and must not count as caller dirt.
  if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=normal -- . ':(exclude).local/reset-worktree.lock' 2>/dev/null)" ]; then
    echo "Error: untracked files detected." >&2
    echo "Remove or commit them first, or rerun with --force to discard." >&2
    exit 1
  fi
}

clear_index_lock() {
  local index_lock
  index_lock=$(cd "$ROOT" && git rev-parse --path-format=absolute --git-path index.lock)
  if [ -s "$index_lock" ]; then
    echo "Error: $index_lock is non-empty -- a git process is mid-write." >&2
    echo "Wait for it to finish, then rerun the reset." >&2
    exit 1
  fi
  if [ -f "$index_lock" ]; then
    rm -f "$index_lock"
  fi
}

fetch_base_ref() {
  local remote
  case "$BASE_REF" in
    refs/*) ;;
    */*)
      remote=${BASE_REF%%/*}
      if git -C "$ROOT" remote | grep -Fqx -- "$remote"; then
        git -C "$ROOT" fetch "$remote" "${BASE_REF#*/}" >/dev/null
      fi
      ;;
  esac
}

validate_caches() {
  local cache segment normalized
  local -a segments
  if [ "${#CACHES[@]}" -eq 0 ]; then
    return 0
  fi
  for cache in "${CACHES[@]}"; do
    case "$cache" in
      ''|/*)
        echo "Error: cache path must stay inside the worktree: $cache" >&2
        exit 2
        ;;
    esac
    normalized=
    IFS=/ read -r -a segments <<< "$cache"
    for segment in "${segments[@]}"; do
      case "$segment" in
        ''|.) ;;
        ..)
          echo "Error: cache path must stay inside the worktree: $cache" >&2
          exit 2
          ;;
        *) normalized="${normalized:+$normalized/}$segment" ;;
      esac
    done
    case "$normalized" in
      ''|.git|.git/*|.local|.local/*)
        echo "Error: cache path must stay inside the worktree: $cache" >&2
        exit 2
        ;;
    esac
  done
}

remove_caches() {
  local cache
  if [ "${#CACHES[@]}" -gt 0 ]; then
    for cache in "${CACHES[@]}"; do
      rm -rf "$ROOT/$cache"
    done
  fi
  find "$ROOT" \
    \( -path "$ROOT/.git" -o -name node_modules \) -prune -o \
    -type d -name .cache -prune -exec rm -rf {} +
  find "$ROOT" -type d -name node_modules -prune \
    -exec rm -rf '{}/.cache' '{}/.vite' '{}/.vitest' \;
}

run_hook() {
  local hook=$1
  if [ -z "$hook" ]; then
    return 0
  fi
  (cd "$ROOT" && bash -c "$hook")
}

reset_worktree() {
  validate_caches
  refuse_dirty
  clear_index_lock
  fetch_base_ref
  run_hook "$PRE_HOOK"
  local slug new_branch
  slug=$(openssl rand -hex 4)
  new_branch="reset-${slug}"
  if $FORCE; then
    git -C "$ROOT" checkout -B "$new_branch" --force >/dev/null
    git -C "$ROOT" clean -fd -e /.local/reset-worktree.lock >/dev/null
  else
    git -C "$ROOT" checkout -B "$new_branch" >/dev/null
  fi
  git -C "$ROOT" reset --hard "$BASE_REF" >/dev/null
  remove_caches
  run_hook "$POST_HOOK"
  printf 'reset-branch=%s\n' "$new_branch"
}
