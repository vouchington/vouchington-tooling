---
'vouchington-tooling': patch
---

Bound the reusable Gitleaks workflow's history fetch to the event range. It asks the compare API for the merge base and `ahead_by`, fetches the head to depth `ahead_by + 1` and the merge base and base to depth 1 instead of `--unshallow`, and fails if `git rev-list --count` disagrees with `ahead_by`. Step timeouts rise to fit.
