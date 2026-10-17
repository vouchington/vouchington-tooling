---
'vouchington-tooling': minor
---

The `pr_*` MCP tools accept `noSourceIssue` beside a `relatedIssues` list whose every entry is
`refs`; a `closes` entry beside it is still rejected. The Related issues section renders the
`- Refs #N — <reason>` lines immediately before the no-source statement (the policy
`renderNoSourceIssue` wording, or `- No source issue — <reason>`).
