// Runs one export of a consumer's policy module in this fresh process, so the MCP server never
// imports checkout code. argv[2] is the real path of the module. stdin is one JSON object,
// { policyVersion: 1, export, input }. stdout is one JSON object, { ok: true, result },
// { ok: true, skipped: true } when the module has no such export, or { ok: false, error }.
// Console output from the policy goes to stderr so it cannot corrupt the reply.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

console.log = console.info = console.debug = console.error

async function run() {
  const request = JSON.parse(readFileSync(0, 'utf8'))
  if (request.policyVersion !== 1) throw new Error('unsupported policyVersion')
  const policy = await import(pathToFileURL(process.argv[2]).href)
  if (typeof policy[request.export] !== 'function') return { ok: true, skipped: true }
  return { ok: true, result: await policy[request.export](request.input) }
}

const reply = await run().catch((error) => ({
  ok: false,
  error: String((error && error.stack) || error),
}))
process.stdout.write(JSON.stringify(reply), () => process.exit(0))
