import { expect, it } from 'vitest'

import type { RuleContextLike, VariableLike } from './ast-helpers.mts'
import { createFactoryExportVisitors } from './factory-owner-exports.mts'
import { createFactoryProvenance } from './factory-owner-provenance.mts'
import { lintRule, messageIds } from './lint-rule.test-helpers.mts'

const OPTIONS = {
  modules: ['1'],
  factories: ['makeGraph'],
  owners: ['src/owner.js'],
  include: ['**/*.js'],
}

it('normalizes an instantiated mutable expression export', () => {
  const reports: string[] = []
  const variable: VariableLike = {
    name: 'graph',
    defs: [
      {
        type: 'Variable',
        node: {
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: 'graph' },
          init: { type: 'Identifier', name: 'makeGraph' },
        },
        parent: { type: 'VariableDeclaration', kind: 'let' },
      },
    ],
    references: [],
  }
  const context: RuleContextLike = {
    filename: 'src/check.ts',
    options: [],
    report: ({ messageId }) => reports.push(messageId),
    sourceCode: {
      getScope: () => ({
        set: { get: (name) => (name === 'graph' ? variable : undefined) },
        upper: null,
      }),
    },
  }
  const visitors = createFactoryExportVisitors(
    context,
    { modules: new Set(), factories: new Set(['makeGraph']) },
    {
      isFactory: (value) => value?.type === 'Identifier' && value.name === 'makeGraph',
      isNamespace: () => false,
    },
  )
  visitors.ExportDefaultDeclaration?.({
    type: 'ExportDefaultDeclaration',
    declaration: {
      type: 'TSInstantiationExpression',
      expression: { type: 'Identifier', name: 'graph' },
    },
  })
  expect(reports).toEqual(['constructionOwner'])
})

it('coerces primitive literal dynamic import specifiers', async () => {
  for (const [specifier, moduleName] of [
    ['1', '1'],
    ['true', 'true'],
    ['null', 'null'],
  ] as const) {
    const result = await lintRule(
      'factory-owner-location',
      `(await import(${specifier})).makeGraph()`,
      { ...OPTIONS, modules: [moduleName] },
      'src/check.js',
    )
    expect(messageIds(result)).toEqual(['constructionOwner'])
  }
  for (const source of [
    `const specifier = '1'; (await import(specifier)).makeGraph()`,
    `(await import({})).makeGraph()`,
    `(await import(+1n)).makeGraph()`,
  ]) {
    const result = await lintRule('factory-owner-location', source, OPTIONS, 'src/check.js')
    expect(messageIds(result)).toEqual([])
  }
})

it('coerces signed numeric dynamic import specifiers', async () => {
  for (const [specifier, moduleName] of [
    ['-1', '-1'],
    ['+1', '1'],
    ['-1n', '-1'],
  ] as const) {
    const result = await lintRule(
      'factory-owner-location',
      `(await import(${specifier})).makeGraph()`,
      { ...OPTIONS, modules: [moduleName] },
      'src/check.js',
    )
    expect(messageIds(result)).toEqual(['constructionOwner'])
  }
})

it('requires Reflect argument lists before reporting construction', async () => {
  const result = await lintRule(
    'factory-owner-location',
    `import { makeGraph } from '1'
Reflect.apply(makeGraph)
Reflect.apply(makeGraph, null, [])
Reflect.apply(makeGraph, null, null)
Reflect.apply(makeGraph, null, 'args')
Reflect.apply(makeGraph, null, undefined)
Reflect.apply(makeGraph, null, NaN)
Reflect.apply(makeGraph, null, Infinity)
Reflect.apply(makeGraph, null, args)
Reflect.other(makeGraph, [])
Reflect.construct(makeGraph)
Reflect.construct(makeGraph, [])
Reflect.construct(makeGraph, 1)
Reflect.construct(makeGraph, [], () => {})
Reflect.construct(makeGraph, [], null)
Reflect.construct(makeGraph, [], 0)
Reflect.construct(makeGraph, [], async function () {})
Reflect.construct(makeGraph, [], function* () {})
Reflect.construct(makeGraph, [], function () {})
Reflect.construct(makeGraph, [], class {})
Reflect.construct(makeGraph, [], NewTarget)
function shadow(undefined, NaN, Infinity) {
  Reflect.apply(makeGraph, null, undefined)
  Reflect.construct(makeGraph, NaN)
  Reflect.apply(makeGraph, null, Infinity)
}`,
    OPTIONS,
    'src/check.js',
  )
  expect(messageIds(result)).toEqual([
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
  ])
})

it('rejects primitive direct apply lists but permits empty-list values', async () => {
  const result = await lintRule(
    'factory-owner-location',
    `import { makeGraph } from '1'
makeGraph.apply(null, 1)
makeGraph.apply(null, 'args')
makeGraph.apply(null, null)
makeGraph.apply(null, undefined)
makeGraph.apply(null, args)`,
    OPTIONS,
    'src/check.js',
  )
  expect(messageIds(result)).toEqual([
    'constructionOwner',
    'constructionOwner',
    'constructionOwner',
  ])
})

it('rejects reassigned mutable export aliases', async () => {
  const result = await lintRule(
    'factory-owner-location',
    `import { makeGraph } from '1'
let replaced = makeGraph
replaced = () => 1
export default replaced
let stable = makeGraph
export { stable }`,
    OPTIONS,
    'src/check.js',
  )
  expect(messageIds(result)).toEqual(['constructionOwner'])
})

it('follows deeply nested namespace defaults', async () => {
  const result = await lintRule(
    'factory-owner-location',
    `import * as runtime from '1'
const { outer: { nested: { makeGraph } = runtime } = {} } = {}
makeGraph()`,
    OPTIONS,
    'src/check.js',
  )
  expect(messageIds(result)).toEqual(['constructionOwner'])
})

it('reports exported identifier import-equals factory aliases', () => {
  const reports: string[] = []
  const context: RuleContextLike = {
    filename: 'src/check.ts',
    options: [],
    report: ({ messageId }) => reports.push(messageId),
    sourceCode: { getScope: () => ({ upper: null }) },
  }
  const visitors = createFactoryExportVisitors(
    context,
    { modules: new Set(['1']), factories: new Set(['makeGraph']) },
    {
      isFactory: (value) => value?.type === 'Identifier' && value.name === 'makeGraph',
      isNamespace: () => false,
    },
  )
  visitors.ExportNamedDeclaration?.({
    type: 'ExportNamedDeclaration',
    exportKind: 'value',
    specifiers: [],
    declaration: {
      type: 'TSImportEqualsDeclaration',
      moduleReference: { type: 'Identifier', name: 'makeGraph' },
      id: { type: 'Identifier', name: 'exportedGraph' },
    },
  })
  expect(reports).toEqual(['constructionOwner'])
})

it('follows identifier import-equals factory aliases', () => {
  const imported: VariableLike = {
    name: 'makeGraph',
    defs: [
      {
        type: 'ImportBinding',
        node: {
          type: 'ImportSpecifier',
          imported: { type: 'Identifier', name: 'makeGraph' },
        },
        parent: {
          type: 'ImportDeclaration',
          source: { type: 'Literal', value: '1' },
        },
      },
    ],
    references: [],
  }
  const alias: VariableLike = {
    name: 'graph',
    defs: [
      {
        type: 'ImportBinding',
        node: {
          type: 'TSImportEqualsDeclaration',
          moduleReference: { type: 'Identifier', name: 'makeGraph' },
        },
      },
    ],
    references: [],
  }
  const context: RuleContextLike = {
    filename: 'src/check.ts',
    options: [],
    report() {},
    sourceCode: {
      getScope: () => ({
        set: { get: (name) => (name === 'graph' ? alias : imported) },
        upper: null,
      }),
    },
  }
  const provenance = createFactoryProvenance(context, {
    modules: new Set(['1']),
    factories: new Set(['makeGraph']),
  })
  expect(provenance.isFactory({ type: 'Identifier', name: 'graph' })).toBe(true)
})

it('follows destructuring defaults for createRequire loaders', async () => {
  const result = await lintRule(
    'factory-owner-location',
    `import { createRequire } from 'node:module'
const { load = createRequire(import.meta.url) } = {}
const [, arrayLoad = createRequire(import.meta.url)] = []
load('1').makeGraph()
arrayLoad('1').makeGraph()`,
    OPTIONS,
    'src/check.js',
  )
  expect(messageIds(result)).toEqual(['constructionOwner', 'constructionOwner'])
})
