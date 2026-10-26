---
'vouchington-tooling': minor
---

The `setup-node-pnpm` action and this repository's workflows install pnpm with `pnpm/setup`
(`version: latest-12`, `install: false`, `node-version-file: false`) instead of `pnpm/action-setup`,
whose self-installer stalled in `npm ci`. The one-time retry of the pnpm setup step is removed.
`pnpm/setup` applies no one-day release-age cutoff to `latest-12`.
