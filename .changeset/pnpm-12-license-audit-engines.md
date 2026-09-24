---
'vouchington-tooling': patch
---

`dependency-license-policy` no longer reports Unknown licenses under pnpm 12. pnpm 12's `fetch`
ignores `force`, so it skipped optional packages whose `engines` exclude the running Node.js, such
as `@img/sharp-win32-ia32`. The license audit now drops `engines` from its copy of the lockfile and
no longer passes `--config.force=true`.
