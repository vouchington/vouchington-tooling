---
'vouchington-tooling': patch
---

The `pr_validate`, `pr_create`, and `pr_update` MCP tools advertise a `relatedIssues[].repository` pattern without a lookahead. Clients that validate tool schemas with RE2, such as Antigravity, rejected the old pattern and refused to start with the server enabled. The server still enforces the exact owner rule when it parses the input.
