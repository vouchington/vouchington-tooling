---
'vouchington-tooling': minor
---

Add `vouchington-tooling/request-query-profile`: the test-only rule layer for per-request query
profiles. It parses and validates a repeated-query baseline (exact `routes` and `workers` scopes, a
`maxCount`, and either an open `issue` or a permanent `code` pointer), formats and parses the
`[pg-request-profile]` stderr line, parses `pg-worker-profile` JSON, and builds a report-only stale
baseline report from run logs. The route resolver is injected, the query summary is a structural
type, and the baseline path and issue group in failure messages are parameters.
