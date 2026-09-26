---
'vouchington-tooling': minor
---

`collectPnpmLicenseReport` now returns a promise. Interrupted license audits remove their temporary
workspace on SIGINT, SIGTERM, and SIGHUP, and the next audit deletes leftovers whose owner process
is gone, including after SIGKILL. Package fetches reuse a dedicated owner-only store under the pnpm
cache instead of downloading every platform into a fresh store on each run.
