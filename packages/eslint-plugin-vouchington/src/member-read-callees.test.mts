import { expect, it } from 'vitest'
import type { NodeLike, RuleContextLike } from './ast-helpers.mts'
import { isMemberReadException } from './member-read-exceptions.mts'

it('accepts a verified member call through transparent native visitor wrappers', () => {
  const member: NodeLike = {
    type: 'MemberExpression',
    object: { type: 'Identifier', name: 'CacheClient' },
    property: { type: 'Identifier', name: 'invalidate' },
  }
  const assertion: NodeLike = { type: 'TSAsExpression', expression: member }
  const nonNull: NodeLike = { type: 'TSNonNullExpression', expression: assertion }
  member.parent = assertion
  assertion.parent = nonNull
  nonNull.parent = {
    type: 'CallExpression',
    callee: nonNull,
    arguments: [{ type: 'Identifier', name: 'CACHE_GROUP' }],
  }
  const context: RuleContextLike = {
    filename: 'selected.mts',
    options: [],
    report: () => {},
    sourceCode: {
      getScope: () => ({
        upper: null,
        variables: [
          {
            name: 'CacheClient',
            references: [],
            defs: [
              {
                type: 'ImportBinding',
                node: {
                  type: 'ImportSpecifier',
                  imported: { type: 'Identifier', name: 'CacheClient' },
                },
                parent: {
                  type: 'ImportDeclaration',
                  source: { type: 'Literal', value: '@store/cache' },
                },
              },
            ],
          },
          {
            name: 'CACHE_GROUP',
            references: [],
            defs: [
              {
                type: 'Variable',
                node: {
                  type: 'VariableDeclarator',
                  id: { type: 'Identifier', name: 'CACHE_GROUP' },
                  init: { type: 'Literal', value: 'cache:group' },
                  parent: { type: 'VariableDeclaration', kind: 'const' },
                },
              },
            ],
          },
        ],
      }),
    },
  }
  expect(
    isMemberReadException(context, member, [
      {
        file: 'selected.mts',
        member: 'invalidate',
        module: '@store/cache',
        imported: 'CacheClient',
        local: 'CacheClient',
        kind: 'constructor-constant',
        constant: { name: 'CACHE_GROUP', value: 'cache:group' },
      },
    ]),
  ).toBe(true)
})
