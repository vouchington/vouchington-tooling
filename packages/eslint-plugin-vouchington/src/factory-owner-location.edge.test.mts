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
  ]) {
    const result = await lintRule('factory-owner-location', source, OPTIONS, 'src/check.js')
    expect(messageIds(result)).toEqual([])
  }
})
