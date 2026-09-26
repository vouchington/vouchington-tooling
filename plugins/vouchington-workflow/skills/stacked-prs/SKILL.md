---
name: stacked-prs
description: Recognize a native GitHub stacked pull request and drain it from the bottom-most ready layer up, rather than waiting for the whole stack to be ready first.
---

# Stacked pull requests

Use when a change is a chain of native GitHub stacked pull requests. Read local `AGENTS.md` and
`CLAUDE.md` first. They own whether this repository stacks, which tool creates, rebases, and merges
a stack, and who may authorize a merge.

- Each pull request except the bottom one targets the pull request below it. The bottom pull
  request targets the default branch.
- GitHub merges the selected pull request and every unmerged pull request below it, bottom-up, as
  one operation. That merge is available only when everything below already meets this repository's
  merge requirements. An isolated middle layer cannot merge.
- Auto-merge is unsupported. A non-stack merge is not a substitute.
- When a mid-stack pull request's base is an unmerged branch, confirm the merge path understands
  stacks before merging.
- Re-read the forge's layers, order, and bases immediately before a rebase, merge, or status
  report. Local stack metadata is stale after a rebase, relink, or manual recovery.
- The bottom layer's base must be the default branch. Otherwise merge that base or re-root the
  stack onto the default branch before draining.
- Merge the bottom-most ready layer as soon as it is ready. Do not wait for layers above it.
  Nothing in the stack merges on its own.
- Name that bottom-most unmerged layer as the merge target. Naming a higher layer merges more than
  this step when everything below is also ready, and is unavailable when it is not.
- After a merge, GitHub retargets the next unmerged layer onto the default branch. That layer is
  the new bottom.
- On a stall, or when a layer closes without merging, stop if the bottom layer is otherwise ready.
  Report every layer and ask before merging that bottom layer.
- A stall blocks only layers that depend on it. Ready the others. Pause the whole drain only when
  nothing further can be readied without the blocked layer.
- Act only on layers assigned to you. Report the other layers; do not change them.

Consumer wrapper owns: default branch, stacking tool and commands, merge-selector syntax, and
merge authorization.
