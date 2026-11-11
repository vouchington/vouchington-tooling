---
'vouchington-tooling': minor
---

Pass a `diff` input to the policy `validatePullRequest` export from `pr_validate`, `pr_create` and
`pr_update`: `{ additions, deletions, changedFiles, source }`, or `{ unavailable }`. A live pull
request supplies GitHub's counts (`source: 'github'`); otherwise the server sums
`git diff --numstat origin/<base>...HEAD` under a timeout and output cap (`source: 'git'`).
