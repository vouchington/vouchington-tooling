---
'vouchington-tooling': patch
---

Prune pending-build IDs that are provably absent from both the current pnpm lockfile graph and installed package tree before generic pending rebuild finalization.
