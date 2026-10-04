#!/usr/bin/env node
// Plain JavaScript on purpose: the Node version check runs before any TypeScript output loads.
// No top-level await either: Node older than 14.8 must still parse this file to print the message.
import { unsupportedNodeMessage } from './node-guard.mjs'

const unsupported = unsupportedNodeMessage()
if (unsupported === undefined) {
  import('../dist/cli/index.mjs')
    .then((main) => main.runMain())
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : error}\n`)
      process.exitCode = 1
    })
} else {
  process.stderr.write(unsupported)
  process.exitCode = 1
}
