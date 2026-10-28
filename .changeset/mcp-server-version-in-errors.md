---
'vouchington-tooling': minor
---

Every tool error from `vouchington mcp` now ends with `[vouchington-tooling <version> (<install directory>)]`, resolved once at server startup, so a stale or swapped install is obvious. A missing-file failure (`ERR_MODULE_NOT_FOUND` or `ENOENT`) that names a path inside the server's own install also says the install changed underneath the server and to reconnect (`/mcp` in Claude Code, or restart Codex).
