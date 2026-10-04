import { eagerIteration } from './serial-cursor-arguments.mts'
import { expect, it } from 'vitest'
import type { NodeLike, RuleContextLike } from './ast-helpers.mts'
import { createSerialCursorDrainsRule } from './serial-cursor-drains.mts'

it.each(['writeRows', 'other'])(
  'resolves wrapped function bindings using the native visitor contract: %s',
  (name) => {
    const fn: NodeLike = { type: 'ArrowFunctionExpression' }
    const assertion: NodeLike = { type: 'TSAsExpression', expression: fn }
    const satisfies: NodeLike = {
      type: 'TSSatisfiesExpression',
      expression: assertion,
      parent: { type: 'VariableDeclarator', id: { type: 'Identifier', name } },
    }
    fn.parent = assertion
    assertion.parent = satisfies
    const reports: string[] = []
    const context: RuleContextLike = {
      filename: 'selected.mts',
      options: [{ functions: ['writeRows'], includeFiles: ['selected.mts'] }],
      sourceCode: { getScope: () => ({ variables: [], upper: null }) },
      report: ({ messageId }) => {
        reports.push(messageId)
      },
    }
    const call: NodeLike = {
      type: 'CallExpression',
      parent: fn,
      callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'Promise' },
        property: { type: 'Identifier', name: 'all' },
      },
      arguments: [
        {
          type: 'CallExpression',
          callee: {
            type: 'MemberExpression',
            object: { type: 'Identifier', name: 'rows' },
            property: { type: 'Identifier', name: 'map' },
          },
        },
      ],
    }
    createSerialCursorDrainsRule().create(context).CallExpression?.(call)
    expect(reports).toEqual(name === 'writeRows' ? ['serial'] : [])
  },
)

it('accepts absent expression input at the visitor boundary', () => {
  const methods = new Set(['map'])
  expect(eagerIteration(null, methods)).toBe(false)
  expect(eagerIteration(undefined, methods)).toBe(false)
})
