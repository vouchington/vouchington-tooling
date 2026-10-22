#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=tmux-target.sh
source "$SCRIPT_DIR/tmux-target.sh"
tmux_target_socket=''
tmux_target_pane=''
TMUX_TARGET_BIN="${TMUX_TARGET_BIN:-tmux}"

# A title read uses the same pane/worktree check as tmux-name.
tmux_target_resolve "${TMUX_TARGET_ROOT:-$PWD}" "${AGENT_TMUX_SOCKET:-}" "${AGENT_TMUX_PANE:-}" "${AGENT_TMUX_WORKTREE:-}"
"$TMUX_TARGET_BIN" -S "$tmux_target_socket" display-message -p -t "$tmux_target_pane" '#{pane_title}'
