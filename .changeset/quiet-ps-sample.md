---
'vouchington-tooling': patch
---

`storybook-browser-runner` now writes a bounded `ps` sample of the test command's process group (pid,
RSS in MB, %CPU, state and role, never argv) to stderr before terminating a stall or hang, names the
last semantic progress marker and its age in the mid-suite stall message, and keeps Playwright
`targetCrashed` / `detachedFromTarget` protocol lines, counting them as `targetCrashCount` and
`targetDetachCount` in the attempt summary.
