---
'vouchington-tooling': minor
---

Add the `snapshot_archive` MCP tool, which archives many sessions in one call after the server
itself verifies each against the `snapshot_export` file: it confirms the session is in the export,
reads its live entries, compares them by content without the server-assigned `timestamp`, and
archives only on an exact match. It returns only `{ archived, skipped: [{ sessionId, reason }] }`,
never entry content, accepts at most 100 sessions, and leaves the `cleanupToken` valid for
`snapshot_cleanup`. `retrospective-distill` step 7 uses it instead of a per-session
`journal_entries` read plus `session_archive` (`vouchington-workflow` 0.16.1). The loop adapter
parameters and `triage-sweep` Phase E now name the distill cutoffs and archival authorization.
