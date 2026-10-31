---
'vouchington-tooling': minor
---

Give the `setup-node-pnpm` action one total wall-clock deadline (`deadline-seconds`, default `270`)
covering the pnpm binary download and `pnpm install`. The action no longer uses `pnpm/setup`: a new
`download-pnpm.mjs` fetches the resolved pnpm 12 binary from the npm registry under the remaining
budget, and `install.mjs` limits each attempt to the remaining budget minus the kill grace and
starts a retry only when at least 30s remain. On expiry it exits non-zero with
`setup-node-pnpm: deadline 270s exceeded during pnpm install (registry.npmjs.org)`.
