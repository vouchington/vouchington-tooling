---
'vouchington-tooling': patch
---

`createPlaywrightTimeoutGuard({ banOverrides: true })` no longer fails every test that uses Playwright's built-in fixtures. Playwright's `_setupArtifacts` fixture calls `testInfo.setTimeout(testInfo.project.timeout)` for each test, and the guard rejected that call as an override. A runtime `testInfo.setTimeout` back to the project's own (already capped) timeout is now allowed. Other values, the public `test.setTimeout`, `slow`, and `describe.configure({ timeout })` are still rejected.
