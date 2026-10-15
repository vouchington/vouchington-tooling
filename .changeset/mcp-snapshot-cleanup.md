---
'vouchington-tooling': minor
---

Add the `snapshot_cleanup` MCP tool, which deletes a `snapshot_export` file (and a recorded partition directory with its signed receipt) from a server-minted, single-use `cleanupToken` bound to the exporting `sessionId` and worktree. The tool accepts no path, a failed cleanup keeps the token valid for a retry, and `snapshot_export` now returns the server's token instead of the client's.
