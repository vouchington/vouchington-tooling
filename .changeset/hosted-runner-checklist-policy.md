---
'vouchington-tooling': patch
---

Update the `github-actions-checklist` runner rule: prefer the smallest GitHub-hosted runner for
public and private repositories, keep job timeouts below a runner's hard platform limit (for
example, no more than 14 minutes on a runner with a 15-minute cap) so the job's own cancellation
fires first and cleanup steps still run, bound long-running steps and network calls, skip
workspace cleanup on ephemeral runners, and audit for runner-local state (browser, package-manager,
apt, and Docker caches) that a self-hosted-to-hosted migration silently turns into a per-job cost.
