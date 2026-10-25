---
'vouchington-tooling': patch
---

The `setup-node-pnpm` action no longer restores or saves a pnpm store cache with
`actions/cache`. On GitHub-hosted runners a fresh frozen install is the intended path.
