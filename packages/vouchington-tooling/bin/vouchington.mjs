#!/usr/bin/env node
// Plain JavaScript on purpose: the Node version check runs before any TypeScript output loads.
// ES2015 syntax only (no `??`, `?.`, or top-level await) so this file parses on every Node that can
// load a `.mjs` at all (12.17+), and the message prints there. Older Node cannot load `.mjs`.
import { unsupportedNodeMessage } from './node-guard.mjs'

const unsupported = unsupportedNodeMessage()
if (unsupported === undefined) {
  import('../dist/cli/index.mjs')
    .then((main) => main.runMain())
    .catch((error) => {
      process.stderr.write(String((error && error.stack) || error) + '\n')
      process.exitCode = 1
    })
} else {
  process.stderr.write(unsupported)
  process.exitCode = 1
}
