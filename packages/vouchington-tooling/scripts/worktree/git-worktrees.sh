#!/usr/bin/env bash
# Helpers for parsing `git worktree list --porcelain` and identifying worktree paths.

git_worktree_list_porcelain() {
  if [ -n "${1:-}" ]; then
    git -C "$1" worktree list --porcelain
  else
    git worktree list --porcelain
  fi
}

_git_worktree_records() {
  local porcelain
  porcelain=$(git_worktree_list_porcelain "${1:-}") || return 1
  printf '%s\n' "$porcelain" | git_worktree_records_from_porcelain
}

worktree_dir_from_path() {
  local path=$1
  local worktree_dir

  if [[ "$path" == *"/worktrees/"* ]]; then
    worktree_dir=${path#*/worktrees/}
  else
    worktree_dir=$(basename "$path")
  fi

  printf '%s' "$worktree_dir"
}

git_worktree_records_from_porcelain() {
  awk '
    { sub(/\r$/, "") }
    /^worktree / {
      if (have) {
        print path "\t" prunable
      }
      path = substr($0, 10)
      prunable = 0
      have = 1
      next
    }
    /^prunable( |$)/ {
      if (have) {
        prunable = 1
      }
      next
    }
    /^$/ {
      if (have) {
        print path "\t" prunable
        have = 0
        path = ""
        prunable = 0
      }
      next
    }
    END {
      if (have) {
        print path "\t" prunable
      }
    }
  '
}

git_worktree_live_paths() {
  local records path prunable
  records=$(_git_worktree_records "${1:-}") || return 1

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    if [ "$prunable" = 0 ] && [ -d "$path" ]; then
      printf '%s\n' "$path"
    fi
  done <<<"$records"
}

git_worktree_prunable_paths() {
  local records path prunable
  records=$(_git_worktree_records "${1:-}") || return 1

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    if [ "$prunable" = 1 ]; then
      printf '%s\n' "$path"
    fi
  done <<<"$records"
}

git_worktree_main_path() {
  local records path prunable
  records=$(_git_worktree_records "${1:-}") || return 1

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    printf '%s' "$path"
    return 0
  done <<<"$records"
  return 1
}

git_worktree_path_is_registered() {
  local records path prunable
  records=$(_git_worktree_records "$1") || return 1

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    if [ "$path" = "$2" ]; then
      return 0
    fi
  done <<<"$records"
  return 1
}

git_worktree_canonical_path_hash() {
  local path=$1
  local physical_path digest digest_output

  physical_path=$(cd "$path" && pwd -P) || return 1
  digest_output=$(printf '%s' "$physical_path" | openssl dgst -sha256) || return 1
  digest=${digest_output##* }
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1

  printf 'd%s' "${digest:0:12}"
}
