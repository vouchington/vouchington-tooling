---
'vouchington-tooling': minor
---

Make `vouchington mcp` installable once per machine. `agent-blackboard` is now resolved from the server's own install (relative to this package's module, like `@modelcontextprotocol/sdk`) instead of from the worktree a call names, and it is declared as an optional peer dependency; a missing install fails at startup with a message naming the package on stderr. The `worktree` argument must now be an absolute path that is the top level of any git worktree (`git rev-parse --show-toplevel`), no longer only a worktree of the repository the server was launched from. The server starts from a directory outside any git repository; calls that omit `worktree` there return a tool error asking for one, and inside a worktree they still default to its top level.

The `vouchington` bin is now a plain-JavaScript shim (`bin/vouchington.mjs`) that checks the Node version before loading the CLI: on Node older than 24 it prints one line naming the required and found versions to stderr and exits 1, instead of a syntax or import error.

Add a stable MCP entry point, `bin/vouchington-mcp.mjs`, also exposed as the `vouchington-mcp` bin and the `vouchington-tooling/mcp-server/bin` export. It takes no arguments, skips CLI argument parsing, and has the same Node version guard. `vouchington mcp` keeps working.
