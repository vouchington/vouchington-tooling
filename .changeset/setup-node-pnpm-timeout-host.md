---
'vouchington-tooling': patch
---

The `setup-node-pnpm` action now names the registry host when a `pnpm install` attempt times out,
for example `pnpm install attempt 1/1 timed out after 150s (registry.npmjs.org); giving up`. The
retry warning carries the same host, matching the deadline error.
