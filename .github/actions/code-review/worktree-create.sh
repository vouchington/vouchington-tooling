#!/usr/bin/env bash
# Claude Code WorktreeCreate hook: create the tree under OS tmpdir.
set -euo pipefail
dir="$(mktemp -d "${TMPDIR:-/tmp}/code-review-wt.XXXXXX")"
git -C "${GITHUB_WORKSPACE:?}" worktree add --detach "$dir" HEAD >&2
printf '%s\n' "$dir"
