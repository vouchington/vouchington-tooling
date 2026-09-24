---
'vouchington-tooling': patch
---

Support pnpm 12 lockfiles. When pnpm 12 enforces a `packageManager` pin, it writes
`pnpm-lock.yaml` as two YAML documents: an env document that locks pnpm itself, then the workspace
graph. `dependency-license-policy` failed with `Source contains multiple documents`,
`workspace-gates` reported `failed to parse YAML`, and `pnpm-install` pending-build pruning gave up
without a sign. All three now read the last document, and single-document lockfiles still work.

`dependency-license-policy` also stops reporting Unknown licenses under pnpm 12. pnpm 12's `fetch`
ignores `force`, so it skipped optional packages whose `engines` exclude the running Node.js. The
license audit now drops `engines` from its copy of the lockfile and no longer passes
`--config.force=true`.
