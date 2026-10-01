---
'vouchington-tooling': patch
---

Rewrite the packaged `blackboard` skill to record journal entries through one `journal_append` call
of the `vouchington mcp` server, with the note as a tool argument instead of a temporary file, a
replay command, or a provider skill read. The server owns the entry `timestamp`, so callers never
pass one and a failed call is retried by repeating it, and the skill states what `sessionId`
identifies for each tool. Each autonomous admission entry takes a `sourceEventId` unique to its attempt, because a replayed
one returns the earlier receipt. An agent that cannot reach the server stops and reports it.
Retrospectives read every entry and its envelope with `journal_entries`.
`retrospective-distill` now drains every worktree's outbox before exporting, enumerates sessions
with `snapshot_export`, verifies the snapshot file against its checksum, counts, and manifest before
reading full records from it, and archives with `session_archive` only while nothing is pending
and a fresh `journal_entries` read still matches the snapshot. Composed retrospectives are never
saved through `journal_append`, which stores only journal entries.
