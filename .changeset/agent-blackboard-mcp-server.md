---
'vouchington-tooling': minor
---

Add `vouchington mcp`, a stdio MCP server exposing the agent-blackboard journal tools `journal_append`, `journal_entries`, `outbox_status`, `outbox_flush`, `session_ensure`, `snapshot_export`, and `session_archive`. Each tool takes an explicit `sessionId` and an optional `worktree` that must be listed by `git worktree list` for the launch repository. `@modelcontextprotocol/sdk` (and its `zod` peer) is an optional peer dependency needed only for `vouchington mcp`. The `agent-blackboard` subpath also gains `appendJournalMarkdown`, `ensureBlackboardSession`, `archiveBlackboardSession`, and `exportSnapshot`.
