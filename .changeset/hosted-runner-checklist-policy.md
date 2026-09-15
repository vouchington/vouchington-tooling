---
'vouchington-tooling': patch
---

Update the `github-actions-checklist` runner rule: prefer the smallest GitHub-hosted runner for
public and private repositories, keep job timeouts below a runner's hard platform limit, bound
long-running steps and network calls, and skip workspace cleanup on ephemeral runners.
