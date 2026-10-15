---
'vouchington-tooling': minor
---

Add a `vouchington-tooling/fresh-base` module and a `vouchington fresh-base` command that classify a worktree against a remote base branch (default `origin/main`) as up to date, ahead, behind, diverged, dirty, fetch-failed, or unknown. The pure `classifyFreshBase` takes ahead and behind counts, tree state, and fetch result, and `checkFreshBase` gathers them through an injectable Git runner. It is separate from `require-up-to-date`, which fails on staleness rather than reporting it.
