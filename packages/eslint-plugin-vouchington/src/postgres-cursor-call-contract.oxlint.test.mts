import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OXLINT_BIN = resolve(PLUGIN_ROOT, '../../node_modules/.bin/oxlint')
const DIST_PLUGIN = join(PLUGIN_ROOT, 'dist/index.mjs')

describe('postgres-cursor-call-contract oxlint', () => {
  let root: string

  beforeAll(() => {
    const built = spawnSync('pnpm', ['exec', 'tsc', '--project', 'tsconfig.build.json'], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    })
    expect(built.status, built.stderr).toBe(0)
    root = mkdtempSync(join(tmpdir(), 'postgres-cursor-oxlint-'))
    const invalid = join(root, 'src/raw-string.mts')
    const valid = join(root, 'src/annotated.mts')
    const typeOnly = join(root, 'src/type-only.mts')
    mkdirSync(dirname(invalid), { recursive: true })
    writeFileSync(invalid, `import { runCursor } from '@db/cursors'\nrunCursor('SELECT 1')\n`)
    writeFileSync(
      valid,
      `import { runCursor } from '@db/cursors'\n;(runCursor as typeof runCursor)('/* rows */ SELECT 1')\n`,
    )
    writeFileSync(
      typeOnly,
      `import type { runCursor } from '@db/cursors'\nexport type { runCursor }\n`,
    )
    writeFileSync(
      join(root, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off', suspicious: 'off', perf: 'off' },
        jsPlugins: [{ name: 'vouchington', specifier: DIST_PLUGIN }],
        plugins: [],
        rules: {
          'vouchington/postgres-cursor-call-contract': [
            'error',
            { modules: ['@db/cursors'], executors: ['runCursor'] },
          ],
        },
      }),
    )
  })

  afterAll(() => {
    if (root) rmSync(root, { force: true, recursive: true })
  })

  it('loads the built ESM plugin and reports unannotated cursor calls', () => {
    const result = spawnSync(OXLINT_BIN, ['-c', '.oxlintrc.json', '--format', 'json', '.'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    const parsed = JSON.parse(result.stdout || '{}') as {
      diagnostics?: Array<{ code: string; filename: string }>
    }
    const files = (parsed.diagnostics ?? []).map((diagnostic) =>
      diagnostic.filename.replace(`${root}/`, ''),
    )
    expect(files).toContain('src/raw-string.mts')
    expect(files.some((file) => file.endsWith('annotated.mts'))).toBe(false)
    expect(files.some((file) => file.endsWith('type-only.mts'))).toBe(false)
  })
})
