import { describe, expect, it } from 'vitest'

import type { NodeLike, RuleContextLike, VariableLike } from './ast-helpers.mts'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'
import { createFactoryProvenance } from './factory-owner-provenance.mts'

const OPTIONS = {
  modules: ['@compiler/runtime'],
  factories: ['makeGraph'],
  owners: ['src/owner.js'],
  include: ['**/*.js'],
}

async function diagnostics(source: string): Promise<string[]> {
  return messageIds(await lintRule('factory-owner-location', source, OPTIONS, 'src/check.js'))
}

describe('factory-owner-location direct syntax', () => {
  it('follows only the last value of awaited import sequences', async () => {
    expect(await diagnostics(`(await (0, import('@compiler/runtime'))).makeGraph()`)).toEqual([
      'constructionOwner',
    ])
    expect(await diagnostics(`(await (import('@compiler/runtime'), 0)).makeGraph()`)).toEqual([])
  })

  it('recognizes calls through factory call and apply members', async () => {
    expect(
      await diagnostics(`import { makeGraph } from '@compiler/runtime'
makeGraph.call(null)
makeGraph.apply(null, [])
const other = { call() {}, apply() {} }
other.call(null)
other.apply(null)`),
    ).toEqual(['constructionOwner', 'constructionOwner'])
  })

  it('preserves factory identity through await and exported default', async () => {
    expect(
      await diagnostics(`import { makeGraph } from '@compiler/runtime'
(await makeGraph)()
const graph = await makeGraph
graph()
export default await makeGraph`),
    ).toEqual(['constructionOwner', 'constructionOwner', 'constructionOwner'])
  })

  it('does not infer factory provenance from object rest copies', async () => {
    expect(
      await diagnostics(`import * as runtime from '@compiler/runtime'
export const { ...rest } = runtime`),
    ).toEqual([])
  })

  it('checks directly exported mutable initializers and selected namespace properties', async () => {
    expect(
      await diagnostics(`import * as runtime from '@compiler/runtime'
export let graph = runtime.makeGraph
export var namespace = runtime
export let { makeGraph: selected } = runtime`),
    ).toEqual(['constructionOwner', 'constructionOwner', 'constructionOwner'])
    expect(
      await diagnostics(`import * as runtime from '@compiler/runtime'
export let graph = () => 1
export let { unrelated: { makeGraph: nested } } = runtime`),
    ).toEqual([])
  })

  it('keeps nested default patterns specific to configured factories', async () => {
    expect(
      await diagnostics(`import * as runtime from '@compiler/runtime'
export const { default: { makeGraph: graph } } = runtime
export let { default: { makeGraph: mutableGraph } = {} } = runtime
export let { default: mutableNamespace } = runtime
export let { default: { version } } = runtime
const key = 'makeGraph'
export let { [key]: computed } = runtime`),
    ).toEqual(['constructionOwner', 'constructionOwner', 'constructionOwner'])
  })

  it('follows factory-valued destructuring defaults in calls and direct exports', async () => {
    expect(
      await diagnostics(`import { makeGraph } from '@compiler/runtime'
const { missing = makeGraph } = {}
missing()
const { nested: { deep = makeGraph } } = { nested: {} }
deep()
export const { absent = makeGraph } = {}`),
    ).toEqual(['constructionOwner', 'constructionOwner', 'constructionOwner'])
  })

  it('follows nested, namespace, and mutable export defaults without nested false positives', async () => {
    expect(
      await diagnostics(`import * as runtime from '@compiler/runtime'
import { makeGraph } from '@compiler/runtime'
const { missing = runtime } = {}
missing.makeGraph()
const { nested: { deep = makeGraph } = {} } = {}
deep()
export let { mutable = makeGraph } = {}
export let [arrayDefault = makeGraph, , plain] = []
export const { makeGraph: { name } } = runtime`),
    ).toEqual(['constructionOwner', 'constructionOwner', 'constructionOwner', 'constructionOwner'])
  })

  it('stops at cyclic destructuring defaults', async () => {
    expect(
      await diagnostics(`const { missing = missing } = {}
missing()
const { first = second, second = first } = {}
first()`),
    ).toEqual([])
  })

  it('checks split mutable exports from their scoped initializer', async () => {
    expect(
      await diagnostics(`import { makeGraph } from '@compiler/runtime'
let graph = makeGraph
export { graph }
const another = () => 1
export { another }
let { makeGraph: selected } = { makeGraph }
export { selected }
let unrelated = () => 1
export { unrelated }`),
    ).toEqual(['constructionOwner'])
  })

  it('follows the final Reflect receiver and an explicitly configured default factory', async () => {
    expect(
      await diagnostics(`import { makeGraph } from '@compiler/runtime'
(0, Reflect).apply(makeGraph, null, [])
function shadow(Reflect) { (0, Reflect).apply(makeGraph, null, []) }`),
    ).toEqual(['constructionOwner'])
    expect(
      messageIds(
        await lintRule(
          'factory-owner-location',
          `import build from '@compiler/runtime'\nbuild()`,
          { ...OPTIONS, factories: ['default'] },
          'src/check.js',
        ),
      ),
    ).toEqual(['constructionOwner'])
  })

  it('resolves qualified TypeScript import-equals aliases through their scoped namespace', () => {
    const variables = new Map<string, VariableLike>()
    for (const [name, moduleName] of [
      ['runtime', '@compiler/runtime'],
      ['foreign', '@other/runtime'],
    ] as const) {
      variables.set(name, {
        name,
        defs: [
          {
            type: 'ImportBinding',
            node: { type: 'ImportNamespaceSpecifier' },
            parent: {
              type: 'ImportDeclaration',
              source: { type: 'Literal', value: moduleName },
            },
          },
        ],
        references: [],
      })
    }
    for (const [name, namespace] of [
      ['graph', 'runtime'],
      ['unrelated', 'foreign'],
    ] as const) {
      variables.set(name, {
        name,
        defs: [
          {
            type: 'ImportBinding',
            node: {
              type: 'TSImportEqualsDeclaration',
              moduleReference: {
                type: 'TSQualifiedName',
                left: { type: 'Identifier', name: namespace },
                right: { type: 'Identifier', name: 'makeGraph' },
              },
            },
          },
        ],
        references: [],
      })
    }
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report() {},
      sourceCode: {
        getScope: (_node: NodeLike) => ({
          set: { get: (name: string) => variables.get(name) },
          upper: null,
        }),
      },
    }
    const provenance = createFactoryProvenance(context, {
      modules: new Set(['@compiler/runtime']),
      factories: new Set(['makeGraph']),
    })
    expect(provenance.isFactory({ type: 'Identifier', name: 'graph' })).toBe(true)
    expect(provenance.isFactory({ type: 'Identifier', name: 'unrelated' })).toBe(false)
  })
})
