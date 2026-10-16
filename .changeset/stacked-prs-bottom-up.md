---
'vouchington-tooling': patch
---

The `stacked-prs` skill now works a stack bottom-up and merges the ready prefix in one command. Write
layers in stack order, and act on the lowest owned layer that is not ready before any higher layer.
Before `gh stack add` or `gh stack link`, add the open layers to the layers the command would add.
Above the layer cap (default 10, set by the consumer), open independent work on the default branch
and hold dependent work. The merge target is now the top of the ready, approved prefix rather than
the bottom-most ready layer.

Two new references carry the generic stack procedure that was previously only in a downstream
adapter. `references/gh-stack.md` covers the non-interactive `gh stack` commands, importing a stack,
submitting and verifying registration, and reading topology from the forge. `references/drain.md`
covers ownership, shepherding, the ready-prefix merge checks, and reconciling the ledger.
