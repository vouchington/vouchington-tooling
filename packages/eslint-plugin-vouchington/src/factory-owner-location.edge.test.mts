import { expect, it } from 'vitest'

import type { RuleContextLike, VariableLike } from './ast-helpers.mts'
import { createFactoryExportVisitors } from './factory-owner-exports.mts'

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
