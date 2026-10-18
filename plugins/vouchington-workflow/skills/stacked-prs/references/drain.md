# Drain and keep track

Shepherding a layer to ready and merging are different acts. The first covers every pull request
the worker owns in the stack at once. The second lands the whole stack in one command once every
layer is ready, and it is never the agent's own decision.

## Establish scope

1. Resolve the stack from `pulls/<any-layer>.stack`, and record whether the field was present. A
   stack object supplies its number; an explicit `null` means no registered stack. A missing
   preview field: query `stacks?pull_request=<N>`, where one result is the stack and zero means
   unstacked. Do not treat an empty `.stack.number` alone as proof
   that a pull request is unstacked.
2. Read topology from `repos/{owner}/{repo}/stacks/<n>`, ordered bottom to top. A
   `closed && merged_at == null` layer below an open one means the stack is broken. Report it to
   the human, and never merge across it.
3. Partition by ownership, using that topology read plus each member's body from `pulls/<N>` (the
   stack response has no bodies). Shepherd only owned pull requests. Never
   poll, fix, rebase, or push the others, but list them in every report. Owned means this session
   opened the pull request, or a human named it in this session.
   - The opened-by-me half is a durable remote fact when the repository's pull request description
     tool stamps each body with the authoring harness and session id. Compare the stamp with the
     current session id.
   - The named-by-a-human half is conversational and cannot be recovered remotely. That is
     acceptable, because the human can restate it after a compaction.
   - Degrade explicitly. A body without a matching stamp, or with a stamp naming no session id,
     is not owned. Report it as "ownership unverifiable" and never poll it.
   - A parent may assign its stack to one worker by listing the pull request numbers and the
     session id stamped on them. The worker treats that list as assigned and still refuses any
     layer outside it.

## Shepherd the owned layers

Run one stack shepherd poll for the assigned stack, and follow its printed instructions.

- A shepherd's own "owned" mark can mean only that the author login equals the authenticated
  viewer. Several sessions often share one account, so filter every printed row against the
  ownership partition above before acting. Never start a per-pull-request session, fix, or push
  for a row outside it, even when the shepherd marks it owned.
- Apply code fixes, rebases, pushes, and review mutations to owned layers only. Report work
  surfaced on an unowned layer to the human.
- Fix on the owning layer. Commit there, rebase the layers above it (`gh stack rebase --upstack`),
  `gh stack sync` when there are no local stack commits, `gh stack push` once, then rerun the
  shepherd.
  `rebase --upstack` and `push` act through the top of the stack. When an unowned layer sits above
  an owned one, stop at that layer: do not rebase or push it, and hand the remaining rebase and
  push to its owner.
- Start the shepherd with the first pull request. While the poll is in a pure wait and the
  worktree is clean, commit the next layer once the lower layer is in decent shape. On a
  fix-code result, finish it on the owning layer before more upper edits. A ready-delay schedules
  the rerun: continue owned work on a later layer, and do not invent unrelated work.
- Never run a printed merge command unless the human's approval covers that layer and every open
  layer below it, and the checks below pass. `gh stack merge <pr>` lands that pull request and
  every layer below it.
- Mutating git does not parallelize. Stop the poll before a rebase, sync, or push in the stack's
  shared worktree, because other layers' branches can be rewritten underneath it. Discard a poll
  result that was in flight across the mutation, and start the poll again after the push lands.
  Run at most one git mutation at a time.

### Upper-only fast-forward

A queued lower layer, or any lower layer that must not be rewritten, does not stop an upper-only
fast-forward, or upper review and CI work that does not write git.

- Before that push, read the forge and capture the parent head, the parent base, the upper remote
  head, and the stack order. Read all four again immediately before pushing.
- Push only when all four still match, the local upper commit fast-forwards that remote head, and
  it still contains the parent. If anything differs, or the lower layer merges or leaves the queue
  meanwhile, stop and read the forge again. Never push from a stale capture.
- Do not amend, force-push, `gh stack sync`, or `gh stack rebase` a queued parent: each rewrites
  it. When the lower layer changes, re-read topology before branch work that depends on the new
  parent.

### Escalations persist to the pull request

When a layer needs a human, because it is ready and waiting on a merge decision or genuinely
blocked:

- Apply the repository's needs-human label and post one comment per escalation event, not per
  poll, with the layer's position and what it needs.
- When a layer re-escalates, minimize the superseded comment (GraphQL `minimizeComment`,
  `classifier: OUTDATED`). Clear the label once the layer no longer needs a human.
- A relayed merge command is for visibility only. The shepherd picks its target from ready
  results alone and does not know what the human approved.

## Report

When the owned set settles, present the stack bottom to top: each layer's number, owner, state,
and whether it is ready or blocked and why. Never leave a ready bottom layer under a blocked upper
layer without saying so.

## Merge the whole stack

Prefer one merge of the whole stack: when every open layer is ready and inside the approval, the
target is the top layer, and one command lands it and every layer below it. A shepherd that prints
a merge for a lower layer does not change that; when the whole stack is ready, target the top.

Drain bottom-up only when the layers above will clearly take longer than the ready lower layers:
an open requested change or `FIX_CODE`, a pending human review, a blocker, or CI far longer than
the wait so far. A layer a poll or a ready-delay away is not a reason. Then the target is the
highest layer of the ready, approved run from the bottom, still one command, and the report says
why the upper layers were left.

Merge only on explicit human approval. The approval names what it covers: one layer, a range, or
the whole stack. Approving the whole stack also covers a bottom-up drain under the rule above. It
does not cover a layer added after the approval. Ask before merging any layer outside it.

Immediately before the approved merge, run these checks in order:

1. `gh api repos/{owner}/{repo}/stacks/<target>` must return 404. `gh stack merge` resolves a bare
   number as a stack number first, then a pull request number. A 200 response means `--yes` would
   merge every layer of that stack. Stop and ask.
2. Re-read topology. Confirm every layer from the bottom-most open layer up to the target is open,
   ready, and inside the approval, with nothing broken below. Re-read every layer above the
   target too. If those layers are all ready now and the approval covers them, retarget to the
   highest of them and restart these checks from step 1 for the new target. Never retarget past
   the approval; report the ready layers above it and ask.
3. For every layer being merged, capture `pulls/<N>.head.sha` before the final poll and after it.
   They must match. A mismatch means a push landed inside the evaluation window: discard the
   verdict and poll again.
4. `gh stack merge <target> --yes` with the repository's merge strategy. It lands the target and
   every open layer below it.
5. Do not `gh stack sync` here. Return to step 2 of [Establish scope](#establish-scope) and
   re-read topology remotely: rebasing right after a merge can replay already-landed commits from
   a stale local base ref. After a bottom-up drain, keep shepherding the layers above and merge
   the rest the same way, preferring the whole remainder at once. Before any local edit, rebase, or push
   on a remaining layer, rerun the fetch and ahead/behind check in
   [Import a stack](gh-stack.md#import-a-stack-before-acting-on-it): GitHub rebases the next
   layer remotely, so local upper branches are stale until fast-forwarded. The drain is complete when no unmerged owned layer remains.

The window between the last head read and the merge cannot be closed, because `gh stack merge`
has no head-SHA pin. Branch protection and rulesets are evaluated when the merge runs, and stacks
cannot bypass merge requirements. If the merge is rejected, re-read topology instead of retrying
blindly. Under a merge queue, a successful `gh stack merge` only enqueues: the layers queue
together, and a failing layer is ejected along with the layers above it. The next topology
re-read handles that.

When you stop or are blocked (an unresolved escalation, an interrupt or pause, repeated fixes with
no progress, or an external blocker), report each layer's number and state. If the bottom layers
are ready, ask whether to drain them before continuing.

## Keep track: derive the ledger

A hand-kept list of "pull requests I opened" drifts, and a compaction or new session erases it.
The ownership stamp makes the ledger derivable, so state is re-read instead of recalled.

Reconcile broadly, partition narrowly. A new session opens a rival stack because it never looks for
the old one, so the reconcile query is deliberately unfiltered; only the partition is
session-filtered:

```bash
# Reconcile, unfiltered: it finds stacks this session did not create.
gh api --paginate repos/{owner}/{repo}/stacks --jq '.[] | select(.open)'   # 30 per page
gh api --paginate "repos/{owner}/{repo}/pulls?state=open&per_page=100" \
  --jq '.[] | {number, title, user: .user.login, body}'
# Partition: apply the ownership check from Establish scope to that output.
```

- Reconcile before starting anything new. At the start of work, and before opening any pull
  request or stack, surface every open stack or unfinished layer, whoever made it.
- Close out; do not drift away. Close a layer that will not land. Ending or pausing a session with
  owned open layers requires reporting them.
- Continue the stack instead of starting a parallel one. Dependent work for an owned open stack is
  a new layer (`gh stack add`, after the layer cap check). For an unowned open stack, report it and
  ask instead of adding to it or starting a rival.
- Derive state (which pull requests and stacks exist, their positions, their status) every time;
  never cache it. Only intent, such as which stack is being built or what a planned layer is for,
  belongs in the session's plan or journal, and it is a plan, not a record.

Known gaps:

- An ownership stamp is a body line any writer can edit. It is a signal, not an authorization
  boundary, and that is sound only because every merge is human-gated.
- Stack and pull request numbers share no guaranteed disjointness, which is why merge check 1
  runs before every merge.
