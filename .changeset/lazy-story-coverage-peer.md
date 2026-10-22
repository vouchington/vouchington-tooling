---
'vouchington-tooling': patch
---

Fix the `vouchington` CLI failing to load with `ERR_MODULE_NOT_FOUND` when the optional peer
`no-mistakes` is not installed. `story-coverage` now loads on demand and, without the peer, fails
with a message naming the missing optional peer dependency. A policy test keeps the CLI entry's
static import graph free of optional-peer value imports.
