---
'vouchington-tooling': patch
---

Rewrite the packaged `blackboard` skill to record journal entries through one `journal_append` call
of the `vouchington mcp` server, with the note as a tool argument instead of a temporary file, a
replay command, or a provider skill read. Callers fix `timestamp` before the first attempt so a
failed call can be retried exactly, and the skill states what `sessionId` identifies for each tool.
An agent that cannot reach the server stops and reports it. `retrospective-distill` now enumerates
sessions with `snapshot_export`, reads full records from the exported snapshot file, and archives
with `session_archive`. The `vouchington-workflow` plugin advances to 0.10.0.
