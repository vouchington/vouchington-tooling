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
directly. GitHub tracks a chain like this as a single stack, and its own documentation on merging
stacked pull requests is explicit about what a merge then does: "the selected pull request and all
unmerged pull requests below it land on the base branch together as a single operation, ordered
from the bottom up," and merging one is only possible once everything below it already satisfies
whatever this repository requires to merge — you cannot merge an isolated middle layer on its own.
That is dedicated stack-merge behavior, not the ordinary single-branch merge semantics a generic
"merge this PR" action assumes, and it comes with its own restrictions: GitHub does not support
auto-merge for stacked pull requests at all, and a plain, non-stack-aware merge mechanism is not
guaranteed to reproduce this cascade correctly. A mid-stack PR's base ref being an unmerged branch,
not the default branch, is the sign to slow down and confirm the merge path in use actually
understands stacks before treating it as routine.

Drain a stack from the bottom, one layer at a time, merging each bottom-most layer as soon as it
becomes ready rather than waiting for every layer above it to be ready first. A stack should stay as
short as it can be: every layer that remains unmerged keeps accumulating rebase surface, CI cost,
and drift against the default branch, and that cost compounds for every layer still stacked above
it. Because stacked pull requests do not auto-merge, draining only happens through a deliberate
merge action taken each time a layer becomes ready — nothing lands on its own just because it is
ready.

Merging a given layer lands that layer and every unmerged layer below it in the same operation, so
whatever merge target is used must name the bottom-most unmerged layer specifically, not a higher
one, to land exactly the increment intended for that drain step: naming a higher layer either merges
more than intended, when everything below also happens to be ready, or is simply unavailable, when
it is not. Once a layer merges, GitHub retargets the next unmerged layer onto the default branch
directly, so it becomes the new bottom — treat it the same way on the next drain step.

When a drain stalls — something on the stack needs human attention, or a layer closes without
merging — but the bottom-most layer is otherwise ready to merge, stop before yielding: report the
stack's current state layer by layer, and ask whether to merge that ready bottom layer before
continuing. Do not leave a ready bottom layer sitting under a blocked or stalled upper layer without
saying so.

Do not invent a default branch, a stacking tool or its command catalog, an exact merge-selector
syntax, or a merge-authorization policy. A consumer wrapper or local instruction file owns those
choices for this repository.
