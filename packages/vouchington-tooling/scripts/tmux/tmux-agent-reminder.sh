#!/usr/bin/env bash
set -euo pipefail

# Remind the agent to rename the tmux window at workflow checkpoints.
# Called by agent hooks; stdout is injected as context.
#
# Usage: vouchington tmux agent-reminder <event>
#   event: session-start | user-prompt
#   TMUX_TARGET_BIN:    optional tmux binary (default: tmux on PATH).
#   TMUX_TARGET_ROOT:   worktree the pane must belong to (default: $PWD).
#   TMUX_NAME_COMMAND:  command the reminder tells the agent to run
#                       (default: vouchington tmux name).
#
# Silently exits 0 when no tmux context is available.

EVENT="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=tmux-target.sh
source "$SCRIPT_DIR/tmux-target.sh"
tmux_target_socket=''
tmux_target_pane=''
TMUX_TARGET_BIN="${TMUX_TARGET_BIN:-tmux}"
NAME_COMMAND="${TMUX_NAME_COMMAND:-vouchington tmux name}"

if tmux_target_resolve "${TMUX_TARGET_ROOT:-$PWD}" "${AGENT_TMUX_SOCKET:-}" "${AGENT_TMUX_PANE:-}" "${AGENT_TMUX_WORKTREE:-}"; then
  :
else
  # Hook reminders are advisory. The resolver diagnoses invalid bindings and
  # the hook leaves the agent's work alone.
  exit 0
fi

# Drain the hook payload so the caller never blocks on an unread pipe.
cat >/dev/null

pane_title() {
  "$TMUX_TARGET_BIN" -S "$tmux_target_socket" display-message -p -t "$tmux_target_pane" '#{pane_title}' 2>/dev/null || true
}

POLICY="Run: $NAME_COMMAND <name>  (must run unsandboxed: Claude/Codex dangerouslyDisableSandbox; Cursor disable sandbox)
Checkpoints: (1) topic clear → short-hyphenated-name; (2) plan accepted → refine if scope shifted; (3) PR created → append -pr<N> suffix; (4) git push on PR branch → confirm -pr<N> still set; (5) after compaction → verify name still matches topic; (6) reset-worktree → confirm pane title is empty."

json_escape() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}

# Emit structured hook context for events that require JSON stdout.
emit_json() {
  printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' \
    "$(json_escape "$1")" "$(json_escape "$2")"
}

case "$EVENT" in
  session-start)
    emit_json "SessionStart" "[tmux-window-name] $POLICY"
    ;;
  user-prompt)
    TITLE="$(pane_title)"
    if [ -z "$TITLE" ] || printf '%s' "$TITLE" | grep -qE '^(claude|codex|grok|cursor|agent|zsh|bash|fish|reset|sh)$'; then
      printf '[tmux-window-name] Topic is clear — set the window name now. %s\n' "$POLICY"
    fi
    ;;
esac
