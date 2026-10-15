# Reading the four refs

Use before any rebase or lease push of a branch other agents or humans may also write. Publish this
branch; do not open a replacement pull request.

`origin` and `main` below stand for the consumer's remote and default branch; substitute the names
local policy declares.

## Setup

- Run `git fetch origin main <branch>` as its own command. Never chain the fetch with a rebase,
  reset, or merge.
- HEAD must be the branch being updated. A stack checkout can leave the top layer checked out, so
  check out the layer first. A missing stack field means membership is unknown, not unstacked.
- A dirty worktree stops you before a fast-forward, reset, or rebase. Do not switch branches.
- Continue a conflicted rebase with `GIT_EDITOR=true git rebase --continue`.

## Read the refs

- Print `git rev-parse` of HEAD, `origin/<branch>`, `origin/main`, and local `main` when it exists.
  Local `main` is never the rebase target; when it exists, `git rev-list --left-right --count
  main...origin/main` with a nonzero right count means local `main` is behind.
- Print `git rev-list --left-right --count HEAD...origin/<branch>` (left: commits only on the
  local branch; right: commits only on `origin/<branch>`) and
  `git log --oneline --left-right HEAD...origin/<branch>`.
- Print `git cherry -v origin/<branch> HEAD` and `git cherry -v HEAD origin/<branch>`. A leading `-`
  is the same patch under another SHA; a leading `+` is a patch the other side lacks.
- Treat `git range-diff` as a reading aid, not the rebase cut, and read it from the base those
  commits were built on. Never run it from a new stack parent: after a stack rebase, old parent
  commits look like unique local work.
- Unmatched commits on `origin/<branch>` are new commits someone pushed.

## Lease push

- Capture `<sha>` with `git rev-parse origin/<branch>` after the fetch and before any rewrite. Push
  a non-fast-forward with `git push --force-with-lease=<branch>:<sha> origin <branch>`, always
  naming the remote and branch so a configured push remote cannot change the destination. With concurrent writers,
  capture right after the setup fetch and before any later fetch, so a later fetch cannot silently
  widen the lease.
- If HEAD equals that SHA, do not push.
- If a lease or non-force push is rejected, fetch again and re-read. It is still this branch.

## Unstacked

Before any move and after every move onto `origin/<branch>`, including when HEAD already equals it
(`0 0`) but `origin/main` has advanced, run `git merge-base --is-ancestor origin/main HEAD`. Exit 0
means the branch already contains `origin/main`; nonzero means rebase onto `origin/main`, then lease
push.

| Left/right                                                                                                                                                         | Action                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0 0`, `origin/main` already an ancestor                                                                                                                           | Stop.                                                                                                                                                                                                                                                                                                                                                   |
| `0 0`, `origin/main` not an ancestor                                                                                                                               | Rebase onto `origin/main`, then lease push.                                                                                                                                                                                                                                                                                                             |
| `0 N`                                                                                                                                                              | `git merge --ff-only origin/<branch>`, then the ancestor check.                                                                                                                                                                                                                                                                                         |
| `N 0`                                                                                                                                                              | Read `git log --oneline origin/<branch>..HEAD`: those commits are what a push adds, including a remote rewind to an ancestor. Own unpushed work with `origin/main` an ancestor: `git push origin <branch>`. Otherwise rebase onto `origin/main`, then lease push. A rewind you did not make: stop and ask.                                              |
| Diverged, local-only commits are rewritten copies (every local-only commit has cherry `-`; matching subjects alone do not prove equivalence), no unique local work | Clean tree, `git reset --hard origin/<branch>`, then the ancestor check.                                                                                                                                                                                                                                                                                |
| Diverged, origin has new patches to keep and HEAD has unique local commits                                                                                         | `git rebase origin/<branch>` as its own command, then the ancestor check, then lease push whichever way the check exits (after another rebase onto `origin/main` if it is nonzero). This is the one added rebase target, not a license to rebase onto an arbitrary ref. If the rewrite changed patches and unique local work is mixed in, stop and ask. |

## Stacked

A stack rebase is the usual reason `origin/<branch>` was rewritten, but another agent or a human can
rewrite an unstacked branch the same way.

- On a diverged layer, adopt `origin/<branch>` with `git reset --hard` when the layer is checked
  out, or `git branch -f` when it is not, if the left-right log shows pre-rebase copies: the same
  layer subjects on both sides and old parent subjects only on the left. Require `git cherry`
  patch equivalence (`-`) for every local layer commit first; matching subjects alone do not
  prove it, and a `+` commit is unique local work.
- Never `git rebase origin/<branch>` on a stack layer: it replays parent commits onto the layer.
- Never run the plain rebase-onto-main procedure on a mid-stack branch; use its stack-aware form.
- If the layer has unpushed commits that are not the old parent and not already on origin under a
  new SHA, stop and ask.
- After adopting the rewritten tip, run the stack-aware rebase only when the stack still needs to
  move onto `origin/main`.
