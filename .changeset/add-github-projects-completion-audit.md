---
'vouchington-tooling': minor
---

Add a `github-projects` library for auditing GitHub Projects v2 (org-level, cross-repo) completion:
`auditProjectCompletion` reports a change's closing issues' open project items once few enough
remain, auditing every project an issue belongs to independently, and collapses to a single
skipped-audit notice instead of failing when the token lacks the `project` scope or the GraphQL
call fails with a scope error. Owner, repo, the completion-remainder threshold, and the `gh` runner
are all caller-supplied parameters; the library contains no product identifiers.
