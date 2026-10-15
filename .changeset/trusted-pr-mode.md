---
'vouchington-tooling': minor
---

Security fix for the `pr_*` MCP tools: the mode given to the policy is now derived by the server
from its own launch environment and fails closed, so a caller can no longer pass `interactive` from
an automation context (CI, GitHub Actions and similar) to unlock interactive-only policy
exceptions. `CLAUDE_CODE_SESSION_ATTENDED=0` (an unattended Claude Code run) also counts as automation. The `mode` argument is optional and can only narrow `interactive` to `autonomous`.
Adds `noSourceIssue: { reason }` for pull requests with no source issue (rendered inside Related
issues, overridable by a policy `renderNoSourceIssue` export, and passed to the policy). `pr_validate`
is now read-only: the OPEN-state and head checks apply only to `pr_update`, so it validates merged,
closed, or differently-headed pull requests.
