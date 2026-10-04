#!/usr/bin/env node
// The stable entry point of the MCP server: `<node> <install>/node_modules/vouchington-tooling/bin/
// vouchington-mcp.mjs`. It takes no arguments and skips CLI argument parsing, so a CLI refactor
// cannot move it. Plain JavaScript on purpose: the Node version check runs before anything else.
import { unsupportedNodeMessage } from './node-guard.mjs'

const unsupported = unsupportedNodeMessage()
if (unsupported === undefined) {
  const { runMcpMain } = await import('../dist/mcp-server/main.mjs')
  await runMcpMain()
} else {
  process.stderr.write(unsupported)
  process.exitCode = 1
}
