---
'vouchington-tooling': minor
---

Narrow the Playwright `TestInfo` parameter of `createBrowserErrorsFixture`, `withMonitoredPage`, and `BrowserIssueMonitor` to the exported `MonitoredTestInfo` type, and add a `failOnSkippedTests` option to `TestLifecycleReporter` that fails a run when any test is skipped.
