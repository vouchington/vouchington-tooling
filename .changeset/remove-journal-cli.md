---
'vouchington-tooling': minor
---

Remove the deprecated `vouchington agent-blackboard journal append|entries|status|flush` CLI
fallback and its `formatJournalEntries` helper. The `vouchington mcp` server is the only journal
path. `agent-blackboard probe`, `snapshot partition|cleanup`, and `session-start` are unchanged.
Add `vouchington agent-blackboard distill classify <partition.jsonl> --retro-cutoff ISO8601
--session-cutoff ISO8601`, a CLI entry for `runDistillClassify`.
