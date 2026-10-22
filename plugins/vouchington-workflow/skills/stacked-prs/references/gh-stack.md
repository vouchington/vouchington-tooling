# gh-stack mechanics

Official docs (do not copy): [About](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs),
[CLI](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands),
[Managing](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/managing-stacked-pull-requests),
[Merging](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests).

## Setup

- Install on first stacked use: `gh extension install github/gh-stack`. The feature is in public
  preview.
- If `gh stack` exits 9 (stacks are not enabled on the repository), do not bundle the source issues
  into one pull request. Open one pull request on the default branch for the bottom issue, wait for
  it to merge, then open the next. Say that stacks are unavailable.
- Workflows that must run on stacked pull requests must not set `pull_request.branches` or
  `branches-ignore`. GitHub evaluates `branches: [main]` against `stack.base.ref`, but
  `gh stack submit` opens mid-stack pull requests before the stack object exists
  ([github/gh-stack#425](https://github.com/github/gh-stack/issues/425)), so the filter skips them
  permanently. After a workflow trigger change lands on the default branch, rebase existing stacks
  (`gh stack rebase` or `gh stack sync`) so parent branches include it.

## Agent commands

Use only non-interactive forms, and run every `gh stack` command without a TTY. Run
`git config rerere.enabled true` before the first `init`, which otherwise prompts. An explicit
`checkout` prompts when local and remote compositions differ, and `submit --auto` prompts to
create ordinary pull requests when stacks are disabled; without a TTY these fail instead, so treat
a failure as the exit-9 recovery above rather than answering a prompt.

- `gh stack init <branch>`, rooted on the default branch only. It roots the first layer at the
  local default branch, not `origin/<default>`, and in a linked worktree `git fetch origin` does not
  advance that ref. Fast-forward it with `git fetch origin <default>:<default>` only when no worktree
  has the default branch checked out. Otherwise the checkout that has it fast-forwards itself with
  `git merge --ff-only origin/<default>`; never move it from another worktree.
- `gh stack add <branch>`, after the layer cap check in [SKILL.md](../SKILL.md#work-bottom-up).
- `gh stack checkout <stack-or-pr-number>` imports an existing remote stack. See
  [Import a stack](#import-a-stack-before-acting-on-it).
- `gh stack submit --auto` creates drafts. Immediately update each new pull request's title and
  body with the repository's pull request description tool; auto titles and bodies are not
  sufficient, and an unstamped body fails the ownership check in [drain.md](drain.md).
- `gh stack link <branch-or-pr>...` (bottom to top) registers a stack without local tracking. It
  pushes the branches and creates a draft pull request for any branch without one. Update each
  pull request it created the same way as after `submit --auto`.
- `gh stack view --json` is for acting only. Never use it, or `gh stack bottom`, to decide
  topology, ownership, or bottom-ness.
- `gh stack rebase`, `gh stack rebase --upstack`, `gh stack rebase --continue`,
  `gh stack rebase --abort`.
- `gh stack sync` fetches, fast-forwards the trunk, cascade-rebases every layer onto its updated
  parent, and pushes all branches with `--force-with-lease --atomic`. It rewrites every layer's
  head, so treat it like a rebase: stop the poll first, never run it over a queued layer, and
  expect reviewed heads to change. Do not check out the default branch. Run it without a TTY (a
  TTY prompts on local/remote divergence; without one it aborts) and without `--prune`.
- `gh stack push`.
- `gh stack up <n>`, `gh stack down <n>`, `gh stack top`, `gh stack bottom`, for movement only.
- `gh stack merge <pr> --yes --squash`, or the repository's merge strategy. The pull request number
  is required. `--yes` skips a prompt that a non-interactive runner cannot answer.
- `gh stack unstack [<stack-number>]` (alias `delete`) recovers a mis-rooted stack. With no
  argument it targets the active stack. It unstacks on GitHub and removes local tracking; add
  `--local` to remove only local tracking. Pull requests and branches survive. GitHub leaves
  queued or auto-merge pull requests stacked, and then keeps the stack.

Never run the interactive forms: `gh stack submit` without `--auto`, `gh stack modify`, bare
`gh stack checkout`, `gh stack switch`, or bare `gh stack merge` (a TUI that lands the whole
stack). `gh stack checkout <branch>` resolves only stacks this worktree already tracks. Do not run
`gh stack trunk` from a linked worktree whose default branch is checked out elsewhere.

## Worktree and scope

- One worktree per stack. Move with `up` and `down`. Do not add a worktree per layer:
  `gh stack rebase --upstack` rewrites upper branches, and git refuses to update a branch checked
  out in another worktree.
- `git diff --name-only origin/<default>...HEAD` lists what lands if this layer and every layer
  below merge.
- `git diff --name-only <parent>...HEAD` is this layer's review scope.

## Import a stack before acting on it

`gh stack rebase`, `sync`, `push`, and movement act only on stacks the worktree's local record
tracks. A stack created from another worktree, session, or machine is not tracked. Before rebasing
or pushing a layer, including when a shepherd instruction says to, import the stack:

1. `gh stack checkout <stack-number>`, with the number from `pulls/<N>.stack.number`. It records
   the stack and checks out the top-most unmerged layer. When the worktree already tracks a
   matching stack it only switches branches, so remote-tracking refs can be stale.
2. Resolve the remote gh-stack uses once (`remote.pushDefault` when set, else the only remote,
   else `origin`), and read `origin` below as that remote.
3. gh-stack keeps existing local layer branches as they are, so a stale one makes the next rebase
   start from stale commits. Run `git fetch origin`, then for each unmerged layer branch `<b>` run
   `git rev-list --left-right --count "$b...origin/$b"` (left: local-only commits; right: commits
   only on the pull request head). Branch names may contain shell metacharacters: pass each as a
   quoted variable, never paste it into a command line, and skip names that start with `-`:
   - `0 0`: up to date.
   - `0 N`: fast-forward. Use `git merge --ff-only origin/<b>` on the checked-out layer and
     `git branch -f <b> origin/<b>` on any other.
   - A left count above `0` (ahead or diverged): inspect before rewriting or pushing, as the
     consumer's git procedure describes. Do not open another pull request for the layer.

## Submit and verify the remote stack

- A pull request's base branch selects its comparison target. Chaining bases alone does not
  register a native stack. `gh stack init` and `add` record a local plan. Neither local tracking
  nor a successful pull request creation proves GitHub registered the stack.
- Once an upper layer has committed, reviewable work and its local checks pass, submit the layers
  as drafts with `gh stack submit --auto` while the lower pull request is still open and unqueued.
- Verify remote registration before asking to merge or enqueue the lower pull request. An open
  pull request already in a merge queue cannot join a new stack. If it was queued externally, stop
  registering and report the blocker. Do not dequeue it without authorization or rewrite it. When
  it leaves the queue, re-read it: retry registration if it is still open and unqueued, or recover
  as below if it merged. If it closed without merging, report the broken dependency.
- Do not wait for upper-layer CI or ready status to register the dependency. Do not create empty
  placeholder layers, or start work held for approval, only to preserve a stack.
- After each submission or link, read every intended pull request's `pulls/<N>.stack` and the
  single-stack endpoint. Require the same stack number, the intended bottom-to-top order, and the
  expected bases. Missing preview metadata leaves membership unknown: report that, and do not infer
  success from local tracking.
- If the lower pull request merges before registration, GitHub can reject linking it. Re-read the
  forge, fetch, and rebase the remaining work onto the updated default branch without replaying
  the merged layer. Keep any upper pull request already created. Register several remaining open
  layers as a stack and verify their bases. For a single survivor, read its remote base, retarget
  it to the default branch if needed, and verify that before shepherding it alone: a head rebase
  does not change a base. Report sequential pull requests when no stack registered. Do not recreate
  the merged bottom or chain bases by hand as a substitute.

## Lower-layer review fix

Check out the layer that owns the change and commit there. Then run `gh stack rebase --upstack`
and `gh stack push` once. Do not duplicate the fix in an upper layer.

## The forge is the only truth

Every fact the procedure branches on (topology, layer state, ownership, head SHA) comes from the
REST or GraphQL API, never from local gh-stack metadata. A local base ref can go stale after a
remote relink or rebase and silently replay already-landed commits. `gh stack view --json` also
errors from a worktree whose current branch is not in the stack, which is normal right after a
merge retargets it.

```bash
gh api "repos/{owner}/{repo}/pulls/<N>" --jq '{stackPresent: has("stack"), stack: .stack}'
gh api "repos/{owner}/{repo}/stacks/<n>"   # layers bottom to top, with head.sha and author
gh api --paginate "repos/{owner}/{repo}/stacks" --jq '.[] | select(.open)'   # state is null
                                                                    # and ?state=open is ignored
```

- Use the single-stack endpoint for one stack's layers. The list form returns each layer's
  `base.ref` as `null`.
- `.stack` is a preview field. Its absence is not proof a pull request is unstacked: report "stack
  membership unknown" instead of assuming it is unstacked.
