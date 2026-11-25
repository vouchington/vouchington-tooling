---
'vouchington-tooling': patch
---

`storybook-browser-runner` now logs, and writes to its diagnostics file, a `semantic stall in flight` JSON line when it terminates a mid-suite stall. It names the story modules that started but did not end, the test running in each, how long they ran, the last ended module and the last 10 progress markers. `createVitestStorybookProgressReporter` also emits `test-start` and `test-end` markers (never counted as progress) so the running story is named. The 120s threshold and what counts as progress are unchanged.
