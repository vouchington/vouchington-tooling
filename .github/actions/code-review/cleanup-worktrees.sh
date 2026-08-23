#!/usr/bin/env bash
set -euo pipefail
repo="${GITHUB_WORKSPACE:-}"
if [ -n "$repo" ] && { [ -d "$repo/.git" ] || [ -f "$repo/.git" ]; }; then
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        path="${line#worktree }"
        case "$path" in
          */code-review-wt.*)
            git -C "$repo" worktree remove --force "$path" 2>/dev/null || rm -rf "$path"
            ;;
        esac
        ;;
    esac
  done < <(git -C "$repo" worktree list --porcelain 2>/dev/null || true)
  git -C "$repo" worktree prune 2>/dev/null || true
fi
rm -rf "${TMPDIR:-/tmp}"/code-review-wt.* 2>/dev/null || true
