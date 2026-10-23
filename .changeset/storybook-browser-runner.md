---
'vouchington-tooling': minor
---

Add `vouchington storybook-browser-runner --project <name>` and the `vouchington-tooling/storybook-browser-runner` subpath. It runs the Storybook Vitest browser project under a watchdog with a Vite optimizer cache (persistent and per-attempt), retries on known Vite and browser start-up flakes, a session budget, and stall and hang termination, built on `browser-session-runner`. The Vitest project name, command and argv, result files, completion file, optimizeDeps guidance path, env var prefix and progress marker prefix are parameters.
