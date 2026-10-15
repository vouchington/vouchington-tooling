---
'vouchington-tooling': minor
---

`composeRetrospective` accepts a journal-backed audit source, `journal: {journalLoader}`, for the `## CI Failures` and `## Sandbox & Permission Audit` sections. The report states that both sections were assessed from journal entries only, and a missing, unreachable, or truncated journal never counts as assessed. Sandbox and permission entries use a strict journal block grammar, escaped and bounded like CI failures. Complete coverage without a journal source names the missing source. Section headings and the `## CI Failures` status lines are byte-identical. `JournalLoader`, `JournalLoadResult`, `JournalEntry`, and `JournalAuditOptions` are exported as types from `vouchington-tooling/agent-blackboard`.
