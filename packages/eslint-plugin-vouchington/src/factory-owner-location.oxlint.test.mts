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
const assertedRuntime = await import('@compiler/runtime' as string)
assertedRuntime.makeGraph()
const templateRuntime = await import(\`@compiler/runtime\`)
templateRuntime.makeGraph()
export const pending = import('@compiler/runtime')
const promise = import('@compiler/runtime')
promise.makeGraph()
const awaited = await promise
awaited.makeGraph()
let load = createRequire(import.meta.url)
load('@compiler/runtime').makeGraph()
load(\`@compiler/runtime\`).makeGraph()
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
(await (0, import('@compiler/runtime'))).makeGraph()
makeGraph.call(null)
makeGraph.apply(null, [])
makeGraph.call<null, [], unknown>(null)
Reflect.apply<null, [], unknown>(makeGraph, null, [])
new runtime[null]()
runtime[null]\`source\`
;(await makeGraph)()
const awaitedFactory = await makeGraph
awaitedFactory()
export let mutableFactory = makeGraph
let assertedMutableFactory = makeGraph
export default (0, assertedMutableFactory as unknown)
export var mutableRuntime = runtime
export let { makeGraph: mutableSelection } = runtime
export let { unrelated: { makeGraph: unrelatedSelection } } = runtime
const { missing = makeGraph } = {}
missing()
export const { absent = makeGraph } = {}
;(0, Reflect).apply(makeGraph, null, [])
let split = makeGraph
export { split }
export const { default: { makeGraph: nestedDefault } } = runtime
export const { default: { version } } = runtime
`,
    )
    writeFileSync(
      join(root, 'src/ts-export.ts'),
      `import * as compiler from '@compiler/runtime'\nexport = compiler\n`,
    )
    writeFileSync(
      join(root, 'src/ts-import-equals.ts'),
      `export import compiler = require('@compiler/runtime')
export import type runtimeType = require('@compiler/runtime')
`,
    )
    writeFileSync(
      join(root, 'src/ts-import-binding.ts'),
      `import compiler = require('@compiler/runtime')
compiler.makeGraph()
export = compiler
function shadow(compiler: { makeGraph(): void }) { compiler.makeGraph() }
`,
    )
    writeFileSync(
      join(root, 'src/ts-import-unrelated.ts'),
      `import compiler = require('@other/runtime')
compiler.makeGraph()
export = compiler
`,
    )
    writeFileSync(
      join(root, 'src/ts-mutable-export.ts'),
      `import { makeGraph } from '@compiler/runtime'
let graph = makeGraph
export = graph
`,
    )
    writeFileSync(
      join(root, 'src/ts-instantiated-export.ts'),
      `import { makeGraph } from '@compiler/runtime'
let graph = makeGraph
export default graph<unknown>
`,
    )
    writeFileSync(
      join(root, 'src/ts-qualified.ts'),
      `import * as runtime from '@compiler/runtime'
export import graph = runtime.makeGraph
graph()
export import compiler = runtime
compiler.makeGraph()
import defaultCompiler = runtime.default
defaultCompiler.makeGraph()
export import exposed = runtime.default
import nestedGraph = runtime.default.makeGraph
nestedGraph()
export import exportedGraph = runtime.default.makeGraph
`,
    )
    writeFileSync(
      join(root, 'src/await-export.mts'),
      `import { makeGraph } from '@compiler/runtime'\nexport default await makeGraph\n`,
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
              factories: ['makeGraph', 'null'],
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
      Array.from({ length: 56 }, () => 'vouchington(factory-owner-location)'),
    )
    expect(
      diagnostics.every(
        ({ filename }) =>
          filename.endsWith('src/check.mts') ||
          filename.endsWith('src/await-export.mts') ||
          filename.endsWith('src/ts-export.ts') ||
          filename.endsWith('src/ts-import-equals.ts') ||
          filename.endsWith('src/ts-import-binding.ts') ||
          filename.endsWith('src/ts-mutable-export.ts') ||
          filename.endsWith('src/ts-instantiated-export.ts') ||
          filename.endsWith('src/ts-qualified.ts'),
      ),
    ).toBe(true)
    writeFileSync(
      join(root, 'src/default-factory.mts'),
      `import build from '@compiler/runtime'\nbuild()\n`,
    )
    writeFileSync(
      join(root, '.oxlintrc-default.json'),
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
              factories: ['default'],
              owners: ['src/owner.mts'],
              include: ['src/**/*.mts'],
            },
          ],
        },
      }),
    )
    const defaultResult = spawnSync(
      resolve('node_modules/.bin/oxlint'),
      ['-c', '.oxlintrc-default.json', '--format', 'json', 'src/default-factory.mts'],
      { cwd: root, encoding: 'utf8' },
    )
    expect(defaultResult.status).toBe(1)
    expect(JSON.parse(defaultResult.stdout).diagnostics).toHaveLength(1)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
