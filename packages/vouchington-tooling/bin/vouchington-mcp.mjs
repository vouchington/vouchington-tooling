#!/usr/bin/env node
// The stable entry point of the MCP server: `<node> <install>/node_modules/vouchington-tooling/bin/
// vouchington-mcp.mjs`. It takes no arguments and skips CLI argument parsing, so a CLI refactor
// cannot move it. Plain JavaScript on purpose: the Node version check runs before anything else.
// ES2015 syntax only (no `??`, `?.`, or top-level await) so this file parses on every Node that can
// load a `.mjs` at all (12.17+), and the message prints there. Older Node cannot load `.mjs`.
import { unsupportedNodeMessage } from './node-guard.mjs'

const unsupported = unsupportedNodeMessage()
if (unsupported === undefined) {
  import('../dist/mcp-server/main.mjs')
    .then((main) => main.runMcpMain())
    .catch((error) => {
      process.stderr.write(String((error && error.stack) || error) + '\n')
      process.exitCode = 1
    })
} else {
  process.stderr.write(unsupported)
  process.exitCode = 1
}
