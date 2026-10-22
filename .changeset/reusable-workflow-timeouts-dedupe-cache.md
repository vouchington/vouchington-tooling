---
'vouchington-tooling': patch
---

Lower the `cleanup-artifacts` job timeout below its step-timeout sum, enforce that rule across all
workflows, and make the reusable `pnpm-dedupe` workflow install through the shared
`setup-node-pnpm` action so it restores the pnpm store cache.
