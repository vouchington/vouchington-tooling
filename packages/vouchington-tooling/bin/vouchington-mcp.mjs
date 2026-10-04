#!/usr/bin/env node
// The stable entry point of the MCP server: `<node> <install>/node_modules/vouchington-tooling/bin/
// vouchington-mcp.mjs`. It takes no arguments and skips CLI argument parsing, so a CLI refactor
// cannot move it. Plain JavaScript on purpose: the Node version check runs before anything else.
// No top-level await either: Node older than 14.8 must still parse this file to print the message.
import { unsupportedNodeMessage } from './node-guard.mjs'

const unsupported = unsupportedNodeMessage()
if (unsupported === undefined) {
  import('../dist/mcp-server/main.mjs')
    .then((main) => main.runMcpMain())
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : error}\n`)
      process.exitCode = 1
    })
} else {
  process.stderr.write(unsupported)
  process.exitCode = 1
}
