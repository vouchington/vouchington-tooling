---
'vouchington-tooling': minor
---

The `setup-node-pnpm` action and this repository's workflows install pnpm with `pnpm/setup`
(`install: false`, `node-version-file: false`) instead of `pnpm/action-setup`, whose self-installer
stalled in `npm ci`. The one-time retry of the pnpm setup step is removed. A new
`resolve-pnpm-version` action keeps pnpm unpinned but quarantined: it resolves the highest stable
pnpm 12 release published at least 24 hours ago and passes it to `pnpm/setup`.
