---
'vouchington-tooling': minor
---

`pr_update` now accepts a worktree on a detached HEAD when its commit is the live pull request's
head commit, and uses the live head name; a detached HEAD at any other commit is rejected with
both commits named, and `pr_create` still requires a branch. `pr_validate` now returns `ok`, true
only when there are no blocking errors; blocking errors do not fail the tool call, so callers must
check `ok` or `errors`.
