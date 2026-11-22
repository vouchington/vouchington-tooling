---
'vouchington-tooling': minor
---

Add `playwright-config` with `createPlaywrightTimeoutGuard`, which caps Playwright test, hook, project, fixture, and suite timeouts (default 30,000 ms, configurable guard fixture name), plus `runnablePlaywrightTest`, `createReporter`, `nodeServerCommand`, and small config helpers.
