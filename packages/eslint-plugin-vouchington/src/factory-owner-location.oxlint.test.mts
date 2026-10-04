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
import * as runtime from '@compiler/runtime'
import { createRequire } from 'node:module'
const { makeGraph: defaulted = fallback } = runtime
defaulted()
runtime.default.makeGraph();
(await import('@compiler/runtime')).default.makeGraph()
export const pending = import('@compiler/runtime')
const promise = import('@compiler/runtime')
promise.makeGraph()
const awaited = await promise
awaited.makeGraph()
let load = createRequire(import.meta.url)
load('@compiler/runtime').makeGraph()
const { default: { makeGraph: nested } } = await import('@compiler/runtime')
nested()
import { default as defaultAlias } from '@compiler/runtime'
defaultAlias.makeGraph()
new (0, makeGraph)()
Reflect.apply(makeGraph<string>, null, [])
const specialized = makeGraph<string>
specialized()
export default makeGraph<string>
globalThis.Reflect.apply(makeGraph, null, [])
globalThis.Reflect.construct(makeGraph, [])
function shadowGlobal(globalThis) { globalThis.Reflect.apply(makeGraph, null, []) }
`,
    )
    writeFileSync(
      join(root, 'src/ts-export.ts'),
      `import * as compiler from '@compiler/runtime'\nexport = compiler\n`,
    )
    writeFileSync(
      join(root, 'src/ts-import-equals.ts'),
      `export import compiler = require('@compiler/runtime')\n`,
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
              include: ['src/**/*.mts', 'src/**/*.ts'],
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
      Array.from({ length: 22 }, () => 'vouchington(factory-owner-location)'),
    )
    expect(
      diagnostics.every(
        ({ filename }) =>
          filename.endsWith('src/check.mts') ||
          filename.endsWith('src/ts-export.ts') ||
          filename.endsWith('src/ts-import-equals.ts'),
      ),
    ).toBe(true)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
