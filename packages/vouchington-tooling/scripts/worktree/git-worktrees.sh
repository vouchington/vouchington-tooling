#!/usr/bin/env bash
# Helpers for parsing `git worktree list --porcelain` and identifying worktree paths.

git_worktree_list_porcelain() {
  local repo_root=${1:-}

  if [ -n "$repo_root" ]; then
    (git -C "$repo_root" worktree list --porcelain 2>/dev/null || true)
  else
    (git worktree list --porcelain 2>/dev/null || true)
  fi
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
  local repo_root=${1:-}
  local path prunable

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    if [ "$prunable" = 0 ] && [ -d "$path" ]; then
      printf '%s\n' "$path"
    fi
  done < <(git_worktree_list_porcelain "$repo_root" | git_worktree_records_from_porcelain)
}

git_worktree_prunable_paths() {
  local repo_root=${1:-}
  local path prunable

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    if [ "$prunable" = 1 ]; then
      printf '%s\n' "$path"
    fi
  done < <(git_worktree_list_porcelain "$repo_root" | git_worktree_records_from_porcelain)
}

git_worktree_main_path() {
  local repo_root=${1:-}
  local path prunable

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    printf '%s' "$path"
    return 0
  done < <(git_worktree_list_porcelain "$repo_root" | git_worktree_records_from_porcelain)
}

git_worktree_path_is_registered() {
  local repo_root=$1
  local target_path=$2
  local path prunable

  while IFS=$'\t' read -r path prunable; do
    [ -n "$path" ] || continue
    if [ "$path" = "$target_path" ]; then
      return 0
    fi
  done < <(git_worktree_list_porcelain "$repo_root" | git_worktree_records_from_porcelain)

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
