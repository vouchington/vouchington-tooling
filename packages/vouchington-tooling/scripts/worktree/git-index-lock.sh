#!/usr/bin/env bash
# Removes a 0-byte index.lock left by an interrupted git write.
# A non-empty index.lock means a git process is mid-write, so it stays.
# Git creates a 0-byte lock briefly before writing. Call this only when no
# concurrent git write is expected.

clear_stale_index_lock() {
  local git_dir=$1
  if [ -z "$git_dir" ]; then
    return 1
  fi
  if [ -f "$git_dir/index.lock" ] && [ ! -s "$git_dir/index.lock" ]; then
    rm -f "$git_dir/index.lock"
    printf 'Cleared stale empty index.lock at %s/index.lock\n' "$git_dir"
  fi
}
