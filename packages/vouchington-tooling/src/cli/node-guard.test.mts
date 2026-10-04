import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const bin = fileURLToPath(new URL('../../bin', import.meta.url))
const SHIMS = [
  { name: 'vouchington.mjs', args: ['mcp'], dist: 'cli/index.mjs', run: 'runMain' },
  { name: 'vouchington-mcp.mjs', args: [], dist: 'mcp-server/main.mjs', run: 'runMcpMain' },
]

let root: string
let oldNode: string
beforeAll(() => {
  // A copy of the shims next to a fake `dist`, so the real CLI is neither needed nor run.
  root = mkdtempSync(join(tmpdir(), 'vouchington-node-guard-'))
  cpSync(bin, join(root, 'bin'), { recursive: true })
  for (const { dist, run } of SHIMS) {
    mkdirSync(join(root, 'dist', dist, '..'), { recursive: true })
    writeFileSync(
      join(root, 'dist', dist),
      `export async function ${run}() { process.stdout.write('ran ${run}\\n') }\n`,
    )
  }
  oldNode = join(root, 'stub-node-version.mjs')
  writeFileSync(
    oldNode,
    "Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '18.19.0' } })\n",
  )
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe.each(SHIMS)('bin/$name Node version guard', ({ name, args, run }) => {
  const spawn = (...nodeArguments: string[]) =>
    spawnSync(process.execPath, [...nodeArguments, join(root, 'bin', name), ...args], {
      encoding: 'utf8',
    })

  it('prints one line naming the required and found versions and exits 1 on Node < 24', () => {
    const result = spawn('--import', oldNode)
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('vouchington requires Node >=24 (found 18.19.0)\n')
    expect(result.stdout).toBe('')
  })

  it('loads and runs the built entry on a supported Node', () => {
    const result = spawn()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`ran ${run}\n`)
    expect(result.stderr).toBe('')
  })
})

describe('old-Node parseability', () => {
  it.each([...SHIMS.map((shim) => shim.name), 'node-guard.mjs'])(
    'bin/%s uses no syntax newer than Node 12 can parse',
    (file) => {
      const source = readFileSync(join(bin, file), 'utf8').replace(/^\s*\/\/.*$/gm, '')
      expect(source).not.toMatch(/\?\?|\?\.[^\d]|\bawait\b/)
    },
  )
})
