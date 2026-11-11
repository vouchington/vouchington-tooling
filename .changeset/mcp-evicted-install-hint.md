---
'vouchington-tooling': patch
---

When the `vouchington mcp` server's install directory is deleted while it runs, tool errors now name
the missing directory and say to reconnect the server (`/mcp` in Claude Code, or restart Codex),
instead of only reporting that a dependency is not installed.
