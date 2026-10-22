---
'vouchington-tooling': minor
---

Add `vouchington tmux` and the `vouchington-tooling/tmux` subpath. `tmux up --config <file>` starts
the windows from a JSON config (session prefix, ready marker, launcher pid variable, per-window
command, cwd and env such as ports and telemetry service names) in a worktree-scoped tmux session,
reusing a running session and respawning dead windows. `tmux name`, `tmux read-title` and
`tmux agent-reminder` ship as bash scripts that verify the pane belongs to the worktree first, and
`tmux post-tool` renders the post-tool rename reminder from a hook payload. The tmux binary, worktree
root and rename command come from `TMUX_TARGET_BIN`, `TMUX_TARGET_ROOT` and `TMUX_NAME_COMMAND`.
