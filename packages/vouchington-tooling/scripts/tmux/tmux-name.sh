#!/usr/bin/env bash
set -euo pipefail

# Name the tmux window and pane that belong to the caller's worktree.
# The worktree defaults to the git root of $PWD; override with TMUX_TARGET_ROOT.
# The tmux binary defaults to `tmux`; override with TMUX_TARGET_BIN.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  echo 'Usage: vouchington tmux name [--socket PATH --pane %ID --worktree PATH] NAME'
  exit 0
fi
# shellcheck source=tmux-target.sh
source "$SCRIPT_DIR/tmux-target.sh"
tmux_target_socket=''
tmux_target_pane=''
TMUX_TARGET_BIN="${TMUX_TARGET_BIN:-tmux}"

if tmux_target_parse "${TMUX_TARGET_ROOT:-$PWD}" "$@"; then
  :
else
  resolve_status=$?
  # An interactive command outside tmux has no target. Invalid, partial, stale,
  # and mismatched bindings retain the resolver's diagnostic.
  if [ "$resolve_status" -eq 3 ]; then exit 0; fi
  exit "$resolve_status"
fi

if [ -z "$tmux_target_name" ]; then
  "$TMUX_TARGET_BIN" -S "$tmux_target_socket" set-window-option -t "$tmux_target_pane" automatic-rename on
else
  "$TMUX_TARGET_BIN" -S "$tmux_target_socket" rename-window -t "$tmux_target_pane" -- "$tmux_target_name"
fi
"$TMUX_TARGET_BIN" -S "$tmux_target_socket" select-pane -t "$tmux_target_pane" -T "$tmux_target_name"
