import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { expect, it } from 'vitest'

it('enforces configured direct construction and typed export boundaries in Oxlint', () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-owner-oxlint-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(
      join(root, 'src/check.mts'),
      `import { makeGraph } from '@compiler/runtime'
makeGraph()
new makeGraph()
makeGraph\`source\`
@makeGraph class Decorated {}
Reflect.apply(makeGraph, null, [])
function shadow(Reflect) { Reflect.apply(makeGraph, null, []) }
interface Reflect { marker: string }
Reflect.apply(makeGraph, null, [])
export type { makeGraph } from '@compiler/runtime'
export { makeGraph as graph } from '@compiler/runtime'
`,
    )
    writeFileSync(
      join(root, 'src/owner.mts'),
      `import { makeGraph } from '@compiler/runtime'\nmakeGraph()\n`,
    )
    writeFileSync(
      join(root, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off', suspicious: 'off', perf: 'off' },
        plugins: [],
        jsPlugins: [
          {
            name: 'vouchington',
            specifier: resolve('packages/eslint-plugin-vouchington/src/index.mts'),
          },
        ],
        rules: {
          'vouchington/factory-owner-location': [
            'error',
            {
              modules: ['@compiler/runtime'],
              factories: ['makeGraph'],
              owners: ['src/owner.mts'],
              include: ['src/**/*.mts'],
            },
          ],
        },
      }),
    )
    const result = spawnSync(
      resolve('node_modules/.bin/oxlint'),
      ['-c', '.oxlintrc.json', '--format', 'json', '.'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    const { diagnostics } = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; filename: string }>
    }
    expect(diagnostics.map(({ code }) => code)).toEqual(
      Array.from({ length: 7 }, () => 'vouchington(factory-owner-location)'),
    )
    expect(diagnostics.every(({ filename }) => filename.endsWith('src/check.mts'))).toBe(true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
