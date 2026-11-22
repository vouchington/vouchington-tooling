---
'vouchington-tooling': patch
---

`createPlaywrightTimeoutGuard` infers `fixtureName` as a literal type, so the test from `guardTestTimeouts` has a fixture keyed by that name instead of `Record<string, void>`.
