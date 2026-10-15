---
'vouchington-tooling': patch
---

The `stacked-prs` skill now works a stack bottom-up. Write layers in stack order, and act on the
lowest owned layer that is not ready before any higher layer. Before `gh stack add` or
`gh stack link`, add the open layers to the layers the command would add. Above the layer cap
(default 10, set by the consumer), open independent work on the default branch and hold dependent
work.
