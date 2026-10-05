import { expect, it } from 'vitest'

import type { RuleContextLike, VariableLike } from './ast-helpers.mts'
import { createFactoryExportVisitors } from './factory-owner-exports.mts'
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
Reflect.construct(makeGraph)
Reflect.construct(makeGraph, [])`,
    OPTIONS,
    'src/check.js',
  )
  expect(messageIds(result)).toEqual(['constructionOwner', 'constructionOwner'])
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
