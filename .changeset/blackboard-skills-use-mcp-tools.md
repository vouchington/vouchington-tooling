---
'vouchington-tooling': patch
---

Rewrite the packaged `blackboard` skill to record journal entries through one `journal_append` call
of the `vouchington mcp` server, with the note as a tool argument instead of a temporary file, a
replay command, or a provider skill read. Callers fix `timestamp` before the first attempt so a
failed call can be retried exactly, and the skill states what `sessionId` identifies for each tool.
Each autonomous admission entry takes a `sourceEventId` unique to its attempt, because a replayed
one returns the earlier receipt. An agent that cannot reach the server stops and reports it.
`retrospective-distill` now drains the outbox before exporting, enumerates sessions with
`snapshot_export`, verifies the snapshot file against its checksum, counts, and manifest before
reading full records from it, and archives with `session_archive` only while nothing is pending.
The `vouchington-workflow` plugin advances to 0.10.0.
