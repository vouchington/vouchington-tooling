import { describe, expect, it } from 'vitest'

import type { NodeLike, RuleContextLike } from './ast-helpers.mts'
import { createFactoryExportVisitors } from './factory-owner-exports.mts'
import { createFactoryInvocationVisitors } from './factory-owner-invocation.mts'
import { createFactoryProvenance } from './factory-owner-provenance.mts'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'

const OPTIONS = {
  modules: ['@compiler/runtime'],
  factories: ['makeGraph', 'makeHost'],
  owners: ['src/owner.js'],
  include: ['src/**/*.js'],
}

const cases: Array<{ name: string; code: string; reports: number }> = [
  {
    name: 'named and default imports',
    code: `import { makeGraph as build } from '@compiler/runtime'
import compiler from '@compiler/runtime'
build()
compiler.makeHost()`,
    reports: 2,
  },
  {
    name: 'namespace and computed member imports',
    code: `import * as compiler from '@compiler/runtime'
compiler['makeGraph']()
compiler.makeHost()`,
    reports: 2,
  },
  {
    name: 'dynamic imports and direct namespace aliases',
    code: `const compiler = await import('@compiler/runtime')
const alias = compiler
alias.makeGraph();
(await import('@compiler/runtime')).makeHost()`,
    reports: 2,
  },
  {
    name: 'constant factory and destructuring aliases',
    code: `import * as compiler from '@compiler/runtime'
const graph = compiler.makeGraph
const alias = graph
const { makeHost: host } = compiler
alias()
host()`,
    reports: 2,
  },
  {
    name: 'destructured default namespaces from imports and require',
    code: `import { createRequire } from 'node:module'
const { default: compiler } = await import('@compiler/runtime')
const load = createRequire(import.meta.url)
const { default: loaded } = load('@compiler/runtime')
compiler.makeGraph()
loaded.makeHost()`,
    reports: 2,
  },
  {
    name: 'defaulted destructuring retains factory and namespace provenance',
    code: `import * as compiler from '@compiler/runtime'
const { makeGraph: graph = fallback } = compiler
const { default: runtime = fallback } = await import('@compiler/runtime')
graph()
runtime.makeHost()
export const { makeHost: host = fallback } = compiler`,
    reports: 3,
  },
  {
    name: 'nested default namespace destructuring retains factory provenance',
    code: `const { default: { makeGraph: build } } = await import('@compiler/runtime')
build()
export const { default: { makeHost: host } } = await import('@compiler/runtime')`,
    reports: 2,
  },
  {
    name: 'named default import spelling retains namespace provenance',
    code: `import { default as runtime } from '@compiler/runtime'
runtime.makeGraph()
export { runtime }`,
    reports: 2,
  },
  {
    name: 'direct default namespace members',
    code: `import * as runtime from '@compiler/runtime'
import { createRequire } from 'node:module'
runtime.default.makeGraph();
(await import('@compiler/runtime')).default.makeHost();
createRequire(import.meta.url)('@compiler/runtime').default.makeGraph()`,
    reports: 3,
  },
  {
    name: 'unawaited import promises are not namespaces',
    code: `export const pending = import('@compiler/runtime')
const runtime = import('@compiler/runtime')
runtime.makeGraph()
import('@compiler/runtime').makeHost()`,
    reports: 0,
  },
  {
    name: 'awaited constant import promises restore namespace provenance',
    code: `const pending = import('@compiler/runtime')
const alias = pending
const runtime = await alias
runtime.makeGraph()
export default await pending`,
    reports: 2,
  },
  {
    name: 'reassigned import promises cannot certify awaited namespaces',
    code: `let pending = import('@compiler/runtime')
pending = Promise.resolve({ makeGraph() {} })
const runtime = await pending
runtime.makeGraph()`,
    reports: 0,
  },
  {
    name: 'destructured factory shadowed in a function',
    code: `import * as compiler from '@compiler/runtime'
const { makeGraph: build } = compiler
function consume(build) { build() }
build()`,
    reports: 1,
  },
  {
    name: 'unrelated destructuring from a configured namespace',
    code: `import * as compiler from '@compiler/runtime'
const { unrelated } = compiler
unrelated()
unrelated.makeGraph()`,
    reports: 0,
  },
  {
    name: 'createRequire and namespace aliases',
    code: `import { createRequire } from 'node:module'
const load = createRequire(import.meta.url)
const compiler = load('@compiler/runtime')
compiler.makeGraph()
createRequire(import.meta.url)('@compiler/runtime').makeHost()`,
    reports: 2,
  },
  {
    name: 'awaited createRequire result remains a namespace',
    code: `import { createRequire } from 'node:module'
const load = createRequire(import.meta.url)
const runtime = await load('@compiler/runtime')
runtime.makeGraph()`,
    reports: 1,
  },
  {
    name: 'new, tag, and direct Reflect calls',
    code: `import { makeGraph } from '@compiler/runtime'
new makeGraph()
makeGraph\`source\`
Reflect.apply(makeGraph, null, [])
Reflect.construct(makeGraph, [])`,
    reports: 4,
  },
  {
    name: 'global-qualified Reflect calls retain direct factory provenance',
    code: `import { makeGraph } from '@compiler/runtime'
globalThis.Reflect.apply(makeGraph, null, [])
globalThis.Reflect.construct(makeGraph, [])
function shadow(globalThis) { globalThis.Reflect.apply(makeGraph, null, []) }`,
    reports: 2,
  },
  {
    name: 'final sequence operands retain direct factory and namespace provenance',
    code: `import { makeGraph } from '@compiler/runtime'
import * as runtime from '@compiler/runtime'
new (0, makeGraph)();
(0, makeGraph)();
(0, makeGraph)\`source\`;
(0, runtime).makeGraph()`,
    reports: 4,
  },
  {
    name: 'unrelated new and tagged calls',
    code: `import { makeGraph } from '@compiler/runtime'
const unrelated = () => 1
new unrelated()
unrelated\`source\``,
    reports: 0,
  },
  {
    name: 'direct reexports',
    code: `export { makeGraph as graph, makeHost } from '@compiler/runtime'
export * from '@compiler/runtime'`,
    reports: 3,
  },
  {
    name: 'default reexport from a configured module',
    code: `export { default as compiler } from '@compiler/runtime'`,
    reports: 1,
  },
  {
    name: 'local aliases and default exports',
    code: `import * as compiler from '@compiler/runtime'
const graph = compiler.makeGraph
export { graph }
export default compiler`,
    reports: 2,
  },
  {
    name: 'exported factory variable',
    code: `import * as compiler from '@compiler/runtime'
export const graph = compiler.makeGraph`,
    reports: 1,
  },
  {
    name: 'directly exported factory destructuring',
    code: `import * as compiler from '@compiler/runtime'
export const { makeGraph: graph, unrelated } = compiler`,
    reports: 1,
  },
  {
    name: 'unrelated imports, members and exports',
    code: `import * as compiler from '@domain/runtime'
import { format } from '@compiler/runtime'
compiler.makeGraph()
format()
export { format } from '@compiler/runtime'`,
    reports: 0,
  },
  {
    name: 'unrelated namespace and local exports',
    code: `export * from '@domain/runtime'
export default 1
export const count = 1
const local = () => 1
export { local }`,
    reports: 0,
  },
  {
    name: 'reexports from an unrelated module with a matching local name',
    code: `import { makeGraph } from '@compiler/runtime'
export { makeGraph } from '@domain/runtime'`,
    reports: 0,
  },
  {
    name: 'local names and shadowed namespace values',
    code: `import * as compiler from '@compiler/runtime'
function run(compiler) { compiler.makeGraph() }
function makeGraph() {}
makeGraph()`,
    reports: 0,
  },
  {
    name: 'shadowed Reflect and copied method names',
    code: `import { makeGraph } from '@compiler/runtime'
function run(Reflect) { Reflect.apply(makeGraph, null, []) }
const domain = { makeGraph() {} }
domain.makeGraph()`,
    reports: 0,
  },
  {
    name: 'non-literal dynamic import and unrelated createRequire',
    code: `import { createRequire } from 'node:module'
const compiler = await import(moduleName)
compiler.makeGraph()
createRequire(import.meta.url)('@domain/runtime').makeHost()`,
    reports: 0,
  },
  {
    name: 'shadowed createRequire and mutable aliases',
    code: `const createRequire = () => () => ({ makeGraph() {} })
createRequire()('@compiler/runtime').makeGraph()
import * as compiler from '@compiler/runtime'
let alias = compiler
alias.makeGraph()`,
    reports: 0,
  },
  {
    name: 'reassigned createRequire loader does not certify an alias',
    code: `import { createRequire } from 'node:module'
let load = createRequire(import.meta.url)
load = () => ({ makeGraph() {} })
const compiler = load('@compiler/runtime')
compiler.makeGraph()`,
    reports: 0,
  },
  {
    name: 'unreassigned mutable createRequire loader retains provenance',
    code: `import { createRequire } from 'node:module'
let load = createRequire(import.meta.url)
load('@compiler/runtime').makeGraph()`,
    reports: 1,
  },
  {
    name: 'cyclic constant aliases',
    code: `const first = second
const second = first
first()
first.makeGraph()`,
    reports: 0,
  },
  {
    name: 'cyclic awaited import aliases cannot certify a namespace',
    code: `const first = second
const second = first
const runtime = await first
runtime.makeGraph()`,
    reports: 0,
  },
]

describe('factory-owner-location direct provenance', () => {
  it.each(cases)('$name', async ({ code, reports }) => {
    const result = await lintRule('factory-owner-location', code, OPTIONS, 'src/check.js')
    expect(result.fatalErrorCount).toBe(0)
    expect(messageIds(result)).toEqual(Array.from({ length: reports }, () => 'constructionOwner'))
  })

  it('allows construction in exactly configured owner files', async () => {
    const code = `import { makeGraph } from '@compiler/runtime'\nmakeGraph()`
    expect(
      messageIds(await lintRule('factory-owner-location', code, OPTIONS, 'src/owner.js')),
    ).toEqual([])
    expect(
      messageIds(await lintRule('factory-owner-location', code, OPTIONS, 'src/nested/owner.js')),
    ).toEqual(['constructionOwner'])
  })

  it('does not confuse unknown computed keys with a configured null or then factory', async () => {
    const code = `import * as runtime from '@compiler/runtime'
runtime[key]()
const { [key]: local } = runtime
local()
import('@compiler/runtime').then(() => {})`
    const result = await lintRule(
      'factory-owner-location',
      code,
      { ...OPTIONS, factories: ['null', 'then'] },
      'src/check.js',
    )
    expect(result.fatalErrorCount).toBe(0)
    expect(messageIds(result)).toEqual([])
  })

  it('reports a decorator using a configured factory', () => {
    const reports: string[] = []
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report: ({ messageId }) => reports.push(messageId),
      sourceCode: { getScope: () => ({ upper: null }) },
    }
    const visitors = createFactoryInvocationVisitors(
      context,
      (value) => value?.type === 'Identifier' && value.name === 'makeGraph',
    )
    visitors.Decorator?.({
      type: 'Decorator',
      expression: { type: 'Identifier', name: 'makeGraph' },
    } as NodeLike)
    visitors.Decorator?.({
      type: 'Decorator',
      expression: { type: 'Identifier', name: 'other' },
    } as NodeLike)
    expect(reports).toEqual(['constructionOwner'])
  })

  it('ignores type-only exports from configured modules', () => {
    const reports: string[] = []
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report: ({ messageId }) => reports.push(messageId),
      sourceCode: { getScope: () => ({ upper: null }) },
    }
    const visitors = createFactoryExportVisitors(
      context,
      { modules: new Set(['@compiler/runtime']), factories: new Set(['makeGraph']) },
      { isFactory: () => false, isNamespace: () => false },
    )
    visitors.ExportNamedDeclaration?.({
      type: 'ExportNamedDeclaration',
      exportKind: 'type',
      source: { type: 'Literal', value: '@compiler/runtime' },
      specifiers: [{ type: 'ExportSpecifier', local: { type: 'Identifier', name: 'makeGraph' } }],
    } as NodeLike)
    visitors.ExportAllDeclaration?.({
      type: 'ExportAllDeclaration',
      exportKind: 'type',
      source: { type: 'Literal', value: '@compiler/runtime' },
    } as NodeLike)
    expect(reports).toEqual([])
  })

  it('reports TypeScript export assignments only for configured namespaces', () => {
    const reports: string[] = []
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report: ({ messageId }) => reports.push(messageId),
      sourceCode: { getScope: () => ({ upper: null }) },
    }
    const visitors = createFactoryExportVisitors(
      context,
      { modules: new Set(['@compiler/runtime']), factories: new Set(['makeGraph']) },
      {
        isFactory: () => false,
        isNamespace: (value) => value?.type === 'Identifier' && value.name === 'compiler',
      },
    )
    for (const name of ['other', 'compiler']) {
      visitors.TSExportAssignment?.({
        type: 'TSExportAssignment',
        expression: { type: 'Identifier', name },
      } as NodeLike)
    }
    expect(reports).toEqual(['constructionOwner'])
  })

  it('follows a configured factory through a TypeScript instantiation expression', () => {
    const declaration: NodeLike = {
      type: 'ImportDeclaration',
      source: { type: 'Literal', value: '@compiler/runtime' },
    }
    const specifier: NodeLike = {
      type: 'ImportSpecifier',
      imported: { type: 'Identifier', name: 'makeGraph' },
    }
    const variable = {
      name: 'makeGraph',
      defs: [{ type: 'ImportBinding', node: specifier, parent: declaration }],
      references: [],
    }
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report: () => {},
      sourceCode: {
        getScope: () => ({
          set: { get: (name: string) => (name === 'makeGraph' ? variable : undefined) },
          upper: null,
        }),
      },
    }
    const provenance = createFactoryProvenance(context, {
      modules: new Set(['@compiler/runtime']),
      factories: new Set(['makeGraph']),
    })
    expect(
      provenance.isFactory({
        type: 'TSInstantiationExpression',
        expression: { type: 'Identifier', name: 'makeGraph' },
      }),
    ).toBe(true)
  })

  it('reports direct TypeScript import-equals exports only for configured modules', () => {
    const reports: string[] = []
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report: ({ messageId }) => reports.push(messageId),
      sourceCode: { getScope: () => ({ upper: null }) },
    }
    const visitors = createFactoryExportVisitors(
      context,
      { modules: new Set(['@compiler/runtime']), factories: new Set(['makeGraph']) },
      { isFactory: () => false, isNamespace: () => false },
    )
    for (const moduleName of ['@domain/runtime', '@compiler/runtime']) {
      visitors.ExportNamedDeclaration?.({
        type: 'ExportNamedDeclaration',
        specifiers: [],
        declaration: {
          type: 'TSImportEqualsDeclaration',
          moduleReference: {
            type: 'TSExternalModuleReference',
            expression: { type: 'Literal', value: moduleName },
          },
        },
      } as NodeLike)
    }
    visitors.ExportNamedDeclaration?.({
      type: 'ExportNamedDeclaration',
      specifiers: [],
      declaration: {
        type: 'TSImportEqualsDeclaration',
        importKind: 'type',
        moduleReference: {
          type: 'TSExternalModuleReference',
          expression: { type: 'Literal', value: '@compiler/runtime' },
        },
      },
    } as NodeLike)
    expect(reports).toEqual(['constructionOwner'])
  })
})
