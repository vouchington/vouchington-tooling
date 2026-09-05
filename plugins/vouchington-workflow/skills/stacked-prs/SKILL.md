---
name: stacked-prs
description: Recognize a native GitHub stacked pull request and drain it from the bottom-most ready layer up, rather than waiting for the whole stack to be ready first.
---

# Stacked pull requests

Use whenever a change is submitted as a chain of native GitHub stacked pull requests instead of a
single PR. Read local `AGENTS.md` and `CLAUDE.md` first: they own whether this repository adopts
stacking at all, the tooling used to create, rebase, and merge a stack, and who may authorize a
merge.

A stack is a sequence of branches, each submitted as its own pull request, where every PR but the
bottom-most one targets the PR below it as its base branch instead of targeting the default branch
directly. That parent-branch base is the hazard: a mid-stack PR's base ref is an unmerged branch,
not the default branch, so a generic "merge this PR" action taken on a mid-stack layer can land it
into that unmerged parent instead of where it needs to go. Before treating any merge action on a
stacked PR as safe, confirm its actual base branch, and treat a base that is not the default branch
as a sign the PR is mid-stack.

Drain a stack from the bottom, one layer at a time, merging each bottom-most layer as soon as it
becomes ready rather than waiting for every layer above it to be ready first. A stack should stay as
short as it can be: every layer that remains unmerged keeps accumulating rebase surface, CI cost,
and drift against the default branch, and that cost compounds for every layer still stacked above
it.

Merging a given layer typically lands that layer and every unmerged layer below it too, because that
is what a base chain means: nothing above can land without pulling in everything below it. So
whatever merge selector or target is used must name the bottom-most unmerged layer specifically, not
an arbitrary or more convenient one — naming a higher layer lands multiple layers in one action
instead of draining the stack one layer at a time.

When a drain stalls — something on the stack needs human attention, or a layer closes without
merging — but the bottom-most layer is otherwise ready to merge, stop before yielding: report the
stack's current state layer by layer, and ask whether to merge that ready bottom layer before
continuing. Do not leave a ready bottom layer sitting under a blocked or stalled upper layer without
saying so.

Do not invent a default branch, a stacking tool or its command catalog, an exact merge-selector
syntax, or a merge-authorization policy. A consumer wrapper or local instruction file owns those
choices for this repository.
