#!/usr/bin/env bash
# Reset a git worktree onto a new branch at a caller-supplied base ref.
# Teardown, generated build outputs, and session files stay in caller hooks.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: reset-worktree.sh --base-ref <ref> [--force] [--root <dir>]
       [--cache <path>]... [--pre <command>] [--post <command>]

Fetches <ref> when it names a remote branch (remote/branch), refuses a dirty
or untracked tree unless --force, then checks out reset-<hex> and hard-resets
it to <ref>. --pre runs after fetch and before the branch switch. --post runs
after cache removal. Each --cache value is a relative path removed from the
root. The script also removes .cache directories, and the direct .cache, .vite,
and .vitest directories inside node_modules.
USAGE
}

if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
  usage
  exit 0
fi

FORCE=false
BASE_REF=
ROOT=
PRE_HOOK=
POST_HOOK=
CACHES=()
ORIGINAL_ARGS=("$@")

require_value() {
  if [ "$#" -lt 2 ] || [ -z "${2:-}" ]; then
    echo "Error: $1 requires a value" >&2
    usage >&2
    exit 2
  fi
}

reject_duplicate() {
  echo "Error: duplicate option: $1" >&2
  usage >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --force|-f)
      if $FORCE; then reject_duplicate "$1"; fi
      FORCE=true
      shift
      ;;
    --help|-h)
      echo "Error: help cannot be combined with other arguments" >&2
      usage >&2
      exit 2
      ;;
    --base-ref)
      if [ -n "$BASE_REF" ]; then reject_duplicate "$1"; fi
      require_value "$@"
      BASE_REF=$2
      shift 2
      ;;
    --root)
      if [ -n "$ROOT" ]; then reject_duplicate "$1"; fi
      require_value "$@"
      ROOT=$2
      shift 2
      ;;
    --pre)
      if [ -n "$PRE_HOOK" ]; then reject_duplicate "$1"; fi
      require_value "$@"
      PRE_HOOK=$2
      shift 2
      ;;
    --post)
      if [ -n "$POST_HOOK" ]; then reject_duplicate "$1"; fi
      require_value "$@"
      POST_HOOK=$2
      shift 2
      ;;
    --cache)
      require_value "$@"
      CACHES+=("$2")
      shift 2
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$BASE_REF" ]; then
  echo "Error: --base-ref is required" >&2
  usage >&2
  exit 2
fi

case "$BASE_REF" in
  -*)
    echo "Error: --base-ref must not start with '-': $BASE_REF" >&2
    exit 2
    ;;
esac

ROOT=$(cd "${ROOT:-.}" && pwd -P)
ROOT=$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null) || {
  echo "Error: not inside a git worktree: $ROOT" >&2
  exit 2
}

# shellcheck source=reset-worktree-run.sh
source "$(dirname "$0")/reset-worktree-run.sh"
acquire_reset_lock
if $RESET_UNDER_LOCKF; then
  reset_worktree
else
  run_reset_supervised reset_worktree
fi
