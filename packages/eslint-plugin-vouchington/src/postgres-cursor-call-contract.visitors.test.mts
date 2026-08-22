import { describe, expect, it } from 'vitest'
import type { NodeLike, RuleContextLike, VariableLike } from './ast-helpers.mts'
import { createPostgresCursorCallContractRule } from './postgres-cursor-call-contract.mts'

const options = { modules: ['@db/cursors'], executors: ['runCursor'] }

function importVar(
  name: string,
  specifierType: string,
  imported: { name?: string; value?: unknown } = { name },
): VariableLike {
  const specifier: NodeLike = {
    type: specifierType,
    importKind: 'value',
    imported,
    local: { name },
  }
  const declaration: NodeLike = {
    type: 'ImportDeclaration',
    importKind: 'value',
    source: { type: 'Literal', value: '@db/cursors' },
  }
  specifier.parent = declaration
  const identifier: NodeLike = { type: 'Identifier', name }
  return {
    name,
    defs: [{ type: 'ImportBinding', node: specifier }],
    references: [{ identifier, isWrite: () => false }],
  }
}

function mockContext(
  variable: VariableLike | null,
  reports: Array<{ messageId: string }>,
  extra: Partial<RuleContextLike> = {},
): RuleContextLike {
  return {
    filename: extra.filename ?? '/repo/src/a.js',
    cwd: extra.cwd ?? '/repo',
    options: extra.options ?? [options],
    report: (descriptor) => reports.push({ messageId: descriptor.messageId }),
    sourceCode: {
      getScope: () => ({
        set: { get: () => variable ?? undefined },
        variables: variable ? [variable] : [],
        upper: null,
      }),
    },
  }
}

describe('postgres-cursor-call-contract visitors', () => {
  const rule = createPostgresCursorCallContractRule()

  it('skips type-only exports, type queries, and non-references', () => {
    const variable = importVar('runCursor', 'ImportSpecifier', { value: 'runCursor' })
    const reports: Array<{ messageId: string }> = []
    const visitors = rule.create(mockContext(variable, reports))
    const identifier = variable.references[0]?.identifier as NodeLike
    const typeExport: NodeLike = { type: 'ExportSpecifier', exportKind: 'type' }
    identifier.parent = typeExport
    visitors.Identifier?.(identifier)
    const parentType: NodeLike = { type: 'ExportNamedDeclaration', exportKind: 'type' }
    const valueExport: NodeLike = {
      type: 'ExportSpecifier',
      exportKind: 'value',
      parent: parentType,
    }
    identifier.parent = valueExport
    visitors.Identifier?.(identifier)
    const typeQuery: NodeLike = { type: 'TSTypeQuery' }
    identifier.parent = typeQuery
    visitors.Identifier?.(identifier)
    identifier.parent = { type: 'VariableDeclarator' }
    const otherRef: NodeLike = { type: 'Identifier', name: 'runCursor' }
    variable.references[0] = { identifier: otherRef, isWrite: () => false }
    visitors.Identifier?.(identifier)
    expect(reports).toEqual([])
  })

  it('reports namespace members that are not called directly and ignores type queries', () => {
    const variable = importVar('db', 'ImportNamespaceSpecifier')
    const reports: Array<{ messageId: string }> = []
    const visitors = rule.create(mockContext(variable, reports))
    const object: NodeLike = { type: 'Identifier', name: 'db' }
    const member: NodeLike = {
      type: 'MemberExpression',
      object,
      property: { type: 'Identifier', name: 'runCursor' },
      computed: false,
    }
    object.parent = member
    visitors.MemberExpression?.(member)
    const typeQuery: NodeLike = { type: 'TSTypeQuery' }
    member.parent = typeQuery
    visitors.MemberExpression?.(member)
    expect(reports).toEqual([{ messageId: 'directUse' }])
  })

  it('does not report type-only or unrelated re-exports', () => {
    const reports: Array<{ messageId: string }> = []
    const visitors = rule.create(mockContext(null, reports))
    visitors.ExportAllDeclaration?.({
      type: 'ExportAllDeclaration',
      exportKind: 'type',
      source: { value: '@db/cursors' },
    })
    visitors.ExportNamedDeclaration?.({
      type: 'ExportNamedDeclaration',
      source: { value: '@db/cursors' },
      specifiers: [
        { type: 'ExportSpecifier', exportKind: 'type', local: { name: 'runCursor' } },
        { type: 'ExportSpecifier', local: { value: 'helper' } },
      ],
    })
    expect(reports).toEqual([])
    visitors.ExportNamedDeclaration?.({
      type: 'ExportNamedDeclaration',
      source: { value: '@db/cursors' },
      specifiers: [{ type: 'ExportSpecifier', local: { value: 'runCursor' } }],
    })
    expect(reports).toEqual([{ messageId: 'directUse' }])
  })

  it('returns no visitors when unconfigured or excluded', () => {
    expect(rule.create(mockContext(null, [], { options: [] }))).toEqual({})
    expect(
      rule.create(
        mockContext(null, [], {
          filename: '/repo/src/a.test.js',
          options: [{ ...options, exclude: ['**/*.test.js'] }],
        }),
      ),
    ).toEqual({})
  })
})
