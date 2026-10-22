---
'vouchington-tooling': minor
---

Add a browser-safe `vouchington-tooling/vitest-diagnostics/browser` entry exporting the fake-timer
leak guard without any `node:*` import, export `countResourcesByType` and
`recordForkLeakCheckpoint` from `vouchington-tooling/vitest-diagnostics`, and let
`formatForkLeakDiagnostics` take a `poolMetricsLabel` option (default `pool metrics:`).
