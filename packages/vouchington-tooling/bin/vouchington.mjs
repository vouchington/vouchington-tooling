#!/usr/bin/env node
// Plain JavaScript on purpose: the Node version check runs before any TypeScript output loads.
import { unsupportedNodeMessage } from './node-guard.mjs'

const unsupported = unsupportedNodeMessage()
if (unsupported === undefined) {
  const { runMain } = await import('../dist/cli/index.mjs')
  await runMain()
} else {
  process.stderr.write(unsupported)
  process.exitCode = 1
}
