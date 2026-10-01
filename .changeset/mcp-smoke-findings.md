---
'vouchington-tooling': minor
---

Fix four findings from a headless smoke test of `vouchington mcp`.

`journal_append` no longer takes a `timestamp`; the server owns it and a caller that passes one gets
`unsupported argument(s): timestamp`. Before minting the current time the server reuses the
timestamp of an envelope with the same `sessionId` and `sourceEventId`, found first in the
worktree's durable outbox and then in the session's remote entries, so a retry (repeat the identical
call) stays idempotent across a server restart. The result returns the timestamp used. A changed
envelope under an existing `sourceEventId` is still rejected.

`outbox_status`, `outbox_flush`, and `journal_append` now report `pendingCount` for the caller's
`sessionId` and add `worktreePendingCount` for every session in the worktree outbox. `status` follows
the session count. `outbox_flush` still delivers every retained record in the worktree.

The server `instructions`, the tool error hints, `docs/mcp-server.md`, and the packaged `blackboard`
and `retrospective-distill` skills name the tool prefix of every harness (Claude Code, Codex, Grok,
and Cursor's deferred tools) and tell an agent to search for `journal_append` before concluding the
server is unavailable. `retrospective-distill` drains on `worktreePendingCount`. The docs also record
Cursor's per-user approval: `cursor-agent mcp enable vouchington-tooling` once, and `--approve-mcps`
on every headless `cursor-agent -p` run. The `vouchington-workflow` plugin advances to 0.10.1.

The lockfile now resolves `agent-blackboard` 0.6.1 within the existing `^0.6.0` range.
