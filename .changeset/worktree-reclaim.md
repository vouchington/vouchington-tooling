---
'vouchington-tooling': minor
---

Add `vouchington worktree reclaim`, a small generic command that removes finished git worktrees. It
is a dry run unless `--yes` is passed, and `--json` prints machine output. A worktree is removed
(with a plain `git worktree remove`, never forced) only when it is clean, has no hidden index
entries, and has a merged or closed same-repository PR whose head is exactly its
HEAD. It is not a security boundary.
