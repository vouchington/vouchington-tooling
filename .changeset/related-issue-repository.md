---
'vouchington-tooling': minor
---

The `pr_*` MCP tools accept an optional `repository: "owner/name"` on each `relatedIssues` entry,
rendered as `Closes owner/name#N` or `Refs owner/name#N` so the lines round-trip through
`parseClosingIssueReferences` and `parseNonClosingRefs`. Both `closes` and `refs` may be
cross-repository; an invalid repository is rejected.
