---
'vouchington-tooling': minor
---

`journal_entries` in `vouchington mcp` now returns `{ sessionId, entries }`: every entry of the
session as the `agent-blackboard` client returns it (`sessionId`, `createdAt`, `data`), oldest first.
It previously returned markdown of the `journal` entries' `createdAt` and `markdown` only, which
dropped `retrospective` and legacy entries and every envelope field such as `repositories`. The
`vouchington agent-blackboard journal entries` CLI output is unchanged.
