#!/usr/bin/env bash
# Shared by the name helper and launchers. Sourcing this file never changes tmux.

tmux_target_error() {
  printf 'tmux target: %s\nPass --socket PATH --pane %%ID --worktree PATH from the task worktree.\n' "$1" >&2
  return 1
}

tmux_target_root() {
  local directory git_root
  directory=$(cd -- "$1" && pwd -P) || return 1
  # Git's inherited repository selectors and runtime config can make -C
  # report a different checkout. Keep normal global/system config (including
  # safe.directory) while dropping exported Git overrides.
  if command -v git >/dev/null 2>&1 && git_root=$(
    env -i PATH="${PATH:-/usr/bin:/bin}" HOME="${HOME:-}" XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-}" \
      git -C "$directory" rev-parse --show-toplevel 2>/dev/null
  ); then
    (cd -- "$git_root" && pwd -P)
  else
    printf '%s\n' "$directory"
  fi
}

# Return 3 only when there is no tmux context at all, preserving outside-tmux no-op.
# A partial or untrusted tmux context returns 1 and must never fall back to cwd.
tmux_target_resolve() {
  local expected_root binding_root pane_path pane_root terminal panes candidate candidate_terminal matches socket_prefix
  local tmux_command=${TMUX_TARGET_BIN:-tmux}
  tmux_target_socket=$2
  tmux_target_pane=$3
  tmux_target_worktree=$4
  expected_root=$(tmux_target_root "$1") || return 1
  if [ -z "$tmux_target_socket$tmux_target_pane$tmux_target_worktree${TMUX:-}${TMUX_PANE:-}" ]; then return 3; fi
  if ! command -v "$tmux_command" >/dev/null 2>&1; then
    tmux_target_error 'tmux is missing; install with brew install tmux or apt-get install tmux'; return 1
  fi

  if [ -n "$tmux_target_socket$tmux_target_pane$tmux_target_worktree" ]; then
    if [ -z "$tmux_target_socket" ] || [ -z "$tmux_target_pane" ] || [ -z "$tmux_target_worktree" ]; then
      tmux_target_error 'incomplete explicit binding'; return 1
    fi
    binding_root=$(tmux_target_root "$tmux_target_worktree") || return 1
    if [ "$binding_root" != "$expected_root" ]; then
      tmux_target_error 'binding belongs to a different worktree'; return 1
    fi
  else
    if [ -z "${TMUX:-}${TMUX_PANE:-}" ]; then return 3; fi
    # tty </dev/tty reports the alias /dev/tty on macOS. Query this shell's
    # controlling terminal instead, including when an agent pipes its stdin.
    terminal=$(ps -p "$$" -o tty= 2>/dev/null | tr -d '[:space:]')
    case $terminal in
      ''|*'?'*|'-') tmux_target_error 'no verified controlling terminal or explicit binding'; return 1 ;;
      /dev/*) ;;
      *) terminal=/dev/$terminal ;;
    esac
    case ${TMUX:-} in
      *,*,*) socket_prefix=${TMUX%,*}; tmux_target_socket=${socket_prefix%,*} ;;
      *) tmux_target_error 'missing tmux socket identity'; return 1 ;;
    esac
    panes=$("$tmux_command" -S "$tmux_target_socket" list-panes -a -F $'#{pane_id}\t#{pane_tty}') || {
      tmux_target_error 'unable to list panes on the specified socket'; return 1
    }
    matches=0
    while IFS=$'\t' read -r candidate candidate_terminal; do
      if [ "$candidate_terminal" = "$terminal" ]; then
        tmux_target_pane=$candidate
        matches=$((matches + 1))
      fi
    done <<EOF
$panes
EOF
    if [ "$matches" -ne 1 ]; then
      tmux_target_error 'controlling terminal does not identify exactly one pane'; return 1
    fi
    tmux_target_worktree=$expected_root
  fi

  case $tmux_target_socket in
    /*) ;;
    *) tmux_target_error 'socket must be an absolute path'; return 1 ;;
  esac
  if ! [[ $tmux_target_pane =~ ^%[0-9]+$ ]]; then
    tmux_target_error 'pane must be a literal %ID'; return 1
  fi
  pane_path=$("$tmux_command" -S "$tmux_target_socket" display-message -p -t "$tmux_target_pane" '#{pane_current_path}') || {
    tmux_target_error 'pane is missing or unavailable on the specified socket'; return 1
  }
  if [ -z "$pane_path" ]; then tmux_target_error 'pane has no working directory'; return 1; fi
  pane_root=$(tmux_target_root "$pane_path") || return 1
  if [ "$pane_root" != "$expected_root" ]; then
    tmux_target_error 'pane belongs to a different worktree'; return 1
  fi
  tmux_target_worktree=$expected_root
}

# The resolved name is a public output consumed by callers sourcing this library.
# shellcheck disable=SC2034
tmux_target_parse() {
  local expected=$1 socket='' pane='' worktree='' has_socket=false has_pane=false has_worktree=false has_name=false
  shift
  tmux_target_name=''
  while [ "$#" -gt 0 ]; do
    case $1 in
      --socket|--pane|--worktree)
        if [ "$#" -lt 2 ] || [ -z "$2" ]; then tmux_target_error "missing value for $1"; return 2; fi
        case $1 in
          --socket) if $has_socket; then tmux_target_error 'duplicate --socket'; return 2; fi; socket=$2; has_socket=true ;;
          --pane) if $has_pane; then tmux_target_error 'duplicate --pane'; return 2; fi; pane=$2; has_pane=true ;;
          --worktree) if $has_worktree; then tmux_target_error 'duplicate --worktree'; return 2; fi; worktree=$2; has_worktree=true ;;
        esac
        shift 2 ;;
      --)
        shift
        if [ "$#" -ne 1 ] || $has_name; then tmux_target_error 'provide exactly one name'; return 2; fi
        tmux_target_name=$1; has_name=true; shift ;;
      -*) tmux_target_error "unknown option: $1"; return 2 ;;
      *)
        if $has_name; then tmux_target_error 'provide exactly one name'; return 2; fi
        tmux_target_name=$1; has_name=true; shift ;;
    esac
  done
  if ! $has_name; then tmux_target_error 'provide exactly one name'; return 2; fi
  if $has_socket || $has_pane || $has_worktree; then
    if ! $has_socket || ! $has_pane || ! $has_worktree; then tmux_target_error 'supply all three target options'; return 2; fi
  else
    socket=${AGENT_TMUX_SOCKET:-}; pane=${AGENT_TMUX_PANE:-}; worktree=${AGENT_TMUX_WORKTREE:-}
  fi
  tmux_target_resolve "$expected" "$socket" "$pane" "$worktree"
}
