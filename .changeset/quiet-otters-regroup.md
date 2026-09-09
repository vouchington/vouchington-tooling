---
'vouchington-tooling': patch
---

Add three principles to the `stacked-prs` skill: re-derive a stack's topology and base from the
forge itself rather than trusting a stacking tool's local record, which can go stale after a rebase
or out-of-band relink; confirm the bottom-most layer's base is the default branch before treating a
stack as recoverable, since a stack rooted on unmerged work cannot fully drain; and scope a stall to
the layer it happened on, continuing to ready every other layer — including shepherding only the
layers actually assigned to you — rather than treating one blocked layer as a reason to stop
attending to the rest of the stack.
