import { describe, expect, it } from 'vitest'
import {
  findVariable,
  memberIsRead,
  normalizeFilename,
  patternPropertyName,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'

function identifier(name: string): NodeLike {
  return { type: 'Identifier', name }
}

describe('unwrap', () => {
  it('returns nullish nodes unchanged and peels TypeScript wrappers', () => {
    expect(unwrap(null)).toBeNull()
    expect(unwrap(undefined)).toBeUndefined()
    const inner = identifier('runCursor')
    const wrapped: NodeLike = {
      type: 'TSAsExpression',
      expression: { type: 'TSNonNullExpression', expression: inner },
    }
    expect(unwrap(wrapped)).toBe(inner)
    expect(unwrap(identifier('keep'))).toEqual(identifier('keep'))
    expect(unwrap({ type: 'ChainExpression', expression: identifier('x') })).toEqual(
      identifier('x'),
    )
    expect(unwrap({ type: 'TSSatisfiesExpression', expression: identifier('x') })).toEqual(
      identifier('x'),
    )
    expect(unwrap({ type: 'TSTypeAssertion', expression: identifier('x') })).toEqual(
      identifier('x'),
    )
  })
})

describe('findVariable', () => {
  it('walks scopes and ignores non-identifiers', () => {
    const local: VariableLike = { name: 'local', defs: [], references: [] }
    const outer: VariableLike = { name: 'outer', defs: [], references: [] }
    const context: RuleContextLike = {
      filename: 'src/a.js',
      options: [],
      report: () => {},
      sourceCode: {
        getScope: () => ({
          variables: [],
          upper: {
            set: { get: (name) => (name === 'outer' ? outer : undefined) },
            variables: [outer],
            upper: null,
          },
        }),
      },
    }
    expect(findVariable(context, { type: 'Literal', value: 1 })).toBeNull()
    expect(findVariable(context, identifier('missing'))).toBeNull()
    expect(findVariable(context, identifier('outer'))).toBe(outer)
    const viaList: RuleContextLike = {
      filename: 'src/a.js',
      options: [],
      report: () => {},
      sourceCode: {
        getScope: () => ({ variables: [local], upper: null }),
      },
    }
    expect(findVariable(viaList, identifier('local'))).toBe(local)
    const viaSetMiss: RuleContextLike = {
      filename: 'src/a.js',
      options: [],
      report: () => {},
      sourceCode: {
        getScope: () => ({
          set: { get: () => undefined },
          variables: [local],
          upper: null,
        }),
      },
    }
    expect(findVariable(viaSetMiss, identifier('local'))).toBe(local)
  })
})

describe('propertyName', () => {
  it('reads static member names and ignores dynamic ones', () => {
    expect(propertyName(identifier('x'))).toBeNull()
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: false,
        property: identifier('append'),
      }),
    ).toBe('append')
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: false,
        property: { type: 'Literal', value: 'append' },
      }),
    ).toBeNull()
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: { type: 'Literal', value: 'runCursor' },
      }),
    ).toBe('runCursor')
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: { type: 'Literal', value: 1 },
      }),
    ).toBe(1)
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: { type: 'Literal', value: true },
      }),
    ).toBe(true)
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: { type: 'Literal', value: 1n },
      }),
    ).toBe(1n)
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: { type: 'Literal', value: /x/ },
      }),
    ).toBeNull()
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: {
          type: 'TemplateLiteral',
          expressions: [],
          quasis: [{ value: { cooked: 'runCursor', raw: 'runCursor' } }],
        },
      }),
    ).toBe('runCursor')
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: {
          type: 'TemplateLiteral',
          expressions: [],
          quasis: [{ value: { cooked: null, raw: 'rawName' } }],
        },
      }),
    ).toBe('rawName')
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: { type: 'TemplateLiteral', expressions: [identifier('x')], quasis: [] },
      }),
    ).toBeNull()
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: identifier('method'),
      }),
    ).toBeNull()
    expect(
      propertyName({
        type: 'MemberExpression',
        computed: true,
        property: { type: 'TemplateLiteral', expressions: [], quasis: [] },
      }),
    ).toBeNull()
  })
})

describe('normalizeFilename', () => {
  it('relativizes paths and strips a cwd prefix', () => {
    expect(normalizeFilename({ filename: 'C:\\repo\\src\\a.ts', cwd: 'C:\\repo' })).toBe('src/a.ts')
    expect(normalizeFilename({ filename: '/repo/src/a.ts', cwd: '/repo/' })).toBe('src/a.ts')
    expect(normalizeFilename({ filename: '/other/a.ts', cwd: '/repo' })).toBe('/other/a.ts')
    expect(normalizeFilename({ filename: 'src/a.ts' })).toBe('src/a.ts')
  })
})

describe('patternPropertyName and memberIsRead', () => {
  it('reads object-pattern keys and treats assignment/delete as non-reads', () => {
    expect(patternPropertyName(null)).toBeNull()
    expect(
      patternPropertyName({
        type: 'Property',
        computed: false,
        key: { type: 'Identifier', name: 'invalidate' },
      }),
    ).toBe('invalidate')
    expect(
      patternPropertyName({
        type: 'Property',
        computed: false,
        key: { type: 'Identifier', name: 1 },
      }),
    ).toBeNull()
    expect(
      patternPropertyName({
        type: 'Property',
        computed: true,
        key: { type: 'Literal', value: 'invalidate' },
      }),
    ).toBe('invalidate')
    const member: NodeLike = {
      type: 'MemberExpression',
      property: { type: 'Identifier', name: 'invalidate' },
    }
    expect(memberIsRead(member)).toBe(true)
    const assigned: NodeLike = {
      type: 'MemberExpression',
      property: { type: 'Identifier', name: 'invalidate' },
    }
    assigned.parent = { type: 'AssignmentExpression', operator: '=', left: assigned }
    expect(assigned.parent.left).toBe(assigned)
    expect(memberIsRead(assigned)).toBe(false)
    const compound: NodeLike = {
      type: 'MemberExpression',
      property: { type: 'Identifier', name: 'invalidate' },
    }
    compound.parent = { type: 'AssignmentExpression', operator: '+=', left: compound }
    expect(memberIsRead(compound)).toBe(true)
    expect(
      memberIsRead({
        ...member,
        parent: { type: 'UnaryExpression', operator: 'delete' },
      }),
    ).toBe(false)
  })
})
