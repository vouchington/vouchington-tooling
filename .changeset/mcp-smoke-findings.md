---
'vouchington-tooling': minor
---

Fix four findings from a headless smoke test of `vouchington mcp`.

`journal_append` no longer takes a `timestamp`; the server owns it and a caller that passes one gets
`unsupported argument(s): timestamp`. An event is identified by `sessionId`, `sourceEventId`, and
content, and its timestamp is not part of that identity. Delivery compares an attempt with the
stored entries and the retained outbox record while ignoring only `timestamp`, so a retry (repeat
the identical call) of an event that is already stored or retained is the same event: it writes
nothing, drops the duplicate retained record, and returns the stored record's `timestamp` and
`receipt`. A record retained while the provider was unreachable therefore drains on the next flush
instead of staying as `event-conflict`. Any other difference under an existing `sourceEventId` is
still rejected, and admission freshness (`verifyFreshFeedback`) is unchanged. The result returns the
reported timestamp. `FeedbackReceipt` and the pending `FeedbackDeliveryResult` of the
`vouchington-tooling/agent-blackboard` types gain a `timestamp` field, the stored or retained
record's, so code that builds either value must now set it.

`outbox_status`, `outbox_flush`, and `journal_append` now report `pendingCount` for the caller's
`sessionId` and add `worktreePendingCount` for every session in the worktree outbox. `status` follows
the session count. `outbox_flush` still delivers every retained record in the worktree.

The server `instructions`, the tool error hints, `docs/mcp-server.md`, and the packaged `blackboard`
and `retrospective-distill` skills name the tool prefix of every harness (Claude Code, Codex, Grok,
and Cursor's deferred tools) and tell an agent to search for `journal_append` before concluding the
server is unavailable. `retrospective-distill` drains on `worktreePendingCount`. The docs also record
Cursor's per-user approval: `cursor-agent mcp enable vouchington-tooling` once, and `--approve-mcps`
on every headless `cursor-agent -p` run. The `vouchington-workflow` plugin advances to 0.11.0,
because its `blackboard` skill records journal entries through `journal_append` and its retry
contract only this server honors.

The lockfile now resolves `agent-blackboard` 0.6.1 within the existing `^0.6.0` range.
