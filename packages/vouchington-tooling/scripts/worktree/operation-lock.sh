#!/usr/bin/env bash
# Source this file for a host-wide operation lock held by the sourcing shell.
#
# The lock is a symlink named `lock` under a root directory. Its target is an owner token, and a
# file with that token's name inside the root holds the owner PID. Creating the symlink is atomic,
# so exactly one process holds the lock. A holder whose PID is gone is stale and can be cleared.
#
# Unlike with-host-lock.sh, which wraps one command, these functions protect a region of a
# sourcing script that shares shell state with the code around it.
#
# The root is the first argument, or WORKTREE_OPERATION_LOCK_ROOT. There is no default.
#
# Functions:
#   worktree_operation_lock_acquire [root]      - take the lock, or print why not and return 1
#   worktree_operation_lock_release             - release a lock this shell holds; no-op otherwise
#   worktree_operation_lock_clear_stale [root]  - remove a lock whose owner PID is dead
#
# Variables set:
#   WORKTREE_OPERATION_LOCK_TOKEN        owner token while the lock is held
#   WORKTREE_OPERATION_LOCK_HELD_ROOT    root of the lock this shell holds
#   WORKTREE_OPERATION_LOCK_CLEANUP_STATUS  after clear_stale: missing, removed, active, invalid or busy
#
# Release with a trap, for example: `trap worktree_operation_lock_release EXIT`.

_worktree_operation_lock_resolve_root() {
  local root=${1:-${WORKTREE_OPERATION_LOCK_ROOT:-}}
  if [ -z "$root" ]; then
    echo "Error: worktree operation lock root is not set (pass it or set WORKTREE_OPERATION_LOCK_ROOT)." >&2
    return 1
  fi
  case "$root" in
    /*) ;;
    *)
      echo "Error: worktree operation lock root must be an absolute path: $root" >&2
      return 1
      ;;
  esac
  printf '%s' "$root"
}

_worktree_operation_lock_pid_is_live() {
  [[ "$1" =~ ^[0-9]+$ ]] && kill -0 "$1" 2>/dev/null
}

worktree_operation_lock_acquire() {
  local lock_root lock_path token owner_path held_owner_path held_pid held_token
  local self_pid=${BASHPID:-}
  # Bash 3.2 has no BASHPID; a child shell reports this (sub)shell as its parent.
  [ -n "$self_pid" ] || self_pid=$(exec sh -c 'echo $PPID')
  if [ -n "${WORKTREE_OPERATION_LOCK_TOKEN:-}" ]; then
    echo "Error: this shell already holds a worktree operation lock: ${WORKTREE_OPERATION_LOCK_HELD_ROOT:-}" >&2
    return 1
  fi
  lock_root=$(_worktree_operation_lock_resolve_root "${1:-}") || return 1
  lock_path="$lock_root/lock"
  token="owner.$self_pid.$RANDOM$RANDOM"
  owner_path="$lock_root/$token"

  mkdir -p "$lock_root" || return 1
  if ! printf '%s\n' "$self_pid" >"$owner_path"; then
    rm -f "$owner_path"
    echo "Error: cannot record the worktree operation lock owner: $owner_path" >&2
    return 1
  fi

  if ln -s "$token" "$lock_path" 2>/dev/null; then
    if [ "$(readlink "$lock_path" 2>/dev/null || true)" = "$token" ]; then
      WORKTREE_OPERATION_LOCK_TOKEN=$token
      WORKTREE_OPERATION_LOCK_HELD_ROOT=$lock_root
      return 0
    fi
    # `ln -s` onto a symlink to a directory creates the link inside that directory.
    held_token=$(readlink "$lock_path" 2>/dev/null || true)
    if [[ "$held_token" =~ ^owner\.[0-9]+\.[0-9]+$ ]] \
      && [ -L "$lock_root/$held_token/$token" ] \
      && [ "$(readlink "$lock_root/$held_token/$token")" = "$token" ]; then
      rm -f "$lock_root/$held_token/$token"
    fi
  fi
  if [ ! -L "$lock_path" ]; then
    rm -f "$owner_path"
    echo "Error: worktree operation lock is not a symbolic link: $lock_path" >&2
    return 1
  fi
  held_token=$(readlink "$lock_path")
  if [[ ! "$held_token" =~ ^owner\.[0-9]+\.[0-9]+$ ]]; then
    rm -f "$owner_path"
    echo "Error: worktree operation lock has an invalid owner: $lock_path" >&2
    return 1
  fi
  held_owner_path="$lock_root/$held_token"
  held_pid=$(cat "$held_owner_path" 2>/dev/null || true)
  rm -f "$owner_path"
  if _worktree_operation_lock_pid_is_live "$held_pid"; then
    echo "Error: another worktree operation is running (PID $held_pid)." >&2
  else
    echo "Error: the worktree operation lock is stale; clear it with worktree_operation_lock_clear_stale when no operation is running: $lock_path" >&2
  fi
  return 1
}

worktree_operation_lock_clear_stale() {
  local lock_root lock_path held_owner_path held_pid held_token
  WORKTREE_OPERATION_LOCK_CLEANUP_STATUS=missing
  lock_root=$(_worktree_operation_lock_resolve_root "${1:-}") || return 2
  lock_path="$lock_root/lock"
  [ -L "$lock_path" ] || return 0
  # Serialize clearers so one cannot delete a lock another clearer replaced.
  if ! mkdir "$lock_root/clearing.d" 2>/dev/null; then
    WORKTREE_OPERATION_LOCK_CLEANUP_STATUS=busy
    return 1
  fi
  _worktree_operation_lock_clear_locked "$lock_root"
  local status=$?
  rmdir "$lock_root/clearing.d"
  return "$status"
}

_worktree_operation_lock_clear_locked() {
  local lock_root=$1 lock_path="$1/lock" held_owner_path held_pid held_token
  [ -L "$lock_path" ] || return 0
  held_token=$(readlink "$lock_path")
  if [[ ! "$held_token" =~ ^owner\.[0-9]+\.[0-9]+$ ]]; then
    WORKTREE_OPERATION_LOCK_CLEANUP_STATUS=invalid
    return 1
  fi
  held_owner_path="$lock_root/$held_token"
  held_pid=$(cat "$held_owner_path" 2>/dev/null || true)
  if _worktree_operation_lock_pid_is_live "$held_pid"; then
    WORKTREE_OPERATION_LOCK_CLEANUP_STATUS=active
    return 1
  fi
  # Another process may have cleared and re-taken the lock since the read above.
  [ "$(readlink "$lock_path" 2>/dev/null || true)" = "$held_token" ] || return 1
  rm -f "$lock_path"
  rm -f "$held_owner_path"
  WORKTREE_OPERATION_LOCK_CLEANUP_STATUS=removed
}

worktree_operation_lock_release() {
  local token=${WORKTREE_OPERATION_LOCK_TOKEN:-}
  local lock_root=${WORKTREE_OPERATION_LOCK_HELD_ROOT:-}
  [ -n "$token" ] && [ -n "$lock_root" ] || return 0
  if [ "$(readlink "$lock_root/lock" 2>/dev/null || true)" = "$token" ]; then
    rm -f "$lock_root/lock"
  fi
  rm -f "$lock_root/$token"
  unset WORKTREE_OPERATION_LOCK_TOKEN WORKTREE_OPERATION_LOCK_HELD_ROOT
}
