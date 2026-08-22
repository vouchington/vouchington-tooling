import { describe, expect, it } from 'vitest'
import {
  findVariable,
  propertyName,
  unwrap,
  type CursorAstHelpers,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'
import { isDiscardedSqlStatementAppend } from './postgres-cursor-append.mts'
import {
  isCursorExecutor,
  isCursorModule,
  namedCursorImport,
  namespaceCursorImport,
  namespaceCursorMember,
  namespaceImportMember,
} from './postgres-cursor-imports.mts'
import {
  directCallParent,
  firstQuasiText,
  isTypeQuery,
  queryHead,
  transparentParent,
} from './postgres-cursor-query.mts'

const helpers: CursorAstHelpers = { findVariable, propertyName, unwrap }
const config = { modules: new Set(['@db/cursors']), executors: new Set(['runCursor']) }

function contextFor(variable: VariableLike | null): RuleContextLike {
  return {
    filename: 'src/a.js',
    options: [],
    report: () => {},
    sourceCode: {
      getScope: () => ({
        set: { get: () => variable ?? undefined },
        variables: variable ? [variable] : [],
        upper: null,
      }),
    },
  }
}

function importVariable(
  name: string,
  specifierType: string,
  extras: {
    importKind?: string
    declarationKind?: string
    module?: string
    imported?: string
  } = {},
): VariableLike {
  const specifier: NodeLike = {
    type: specifierType,
    importKind: extras.importKind ?? 'value',
    imported: { name: extras.imported ?? name, type: 'Identifier' },
  }
  const declaration: NodeLike = {
    type: 'ImportDeclaration',
    importKind: extras.declarationKind ?? 'value',
    source: { type: 'Literal', value: extras.module ?? '@db/cursors' },
  }
  specifier.parent = declaration
  return {
    name,
    defs: [{ type: 'ImportBinding', node: specifier, parent: declaration }],
    references: [],
  }
}

describe('cursor import detection', () => {
  it('accepts named and namespace imports and rejects type-only bindings', () => {
    expect(isCursorModule('@db/cursors', config)).toBe(true)
    expect(isCursorModule(1, config)).toBe(false)
    expect(isCursorExecutor('runCursor', config)).toBe(true)
    expect(isCursorExecutor(1, config)).toBe(false)
    const named = importVariable('runCursor', 'ImportSpecifier')
    expect(
      namedCursorImport(
        contextFor(named),
        { type: 'Identifier', name: 'runCursor' },
        helpers,
        config,
      ),
    ).toBe('runCursor')
    expect(
      namedCursorImport(
        contextFor(named),
        { type: 'Literal', value: 'runCursor' },
        helpers,
        config,
      ),
    ).toBeNull()
    expect(
      namedCursorImport(
        contextFor(importVariable('runCursor', 'ImportSpecifier', { importKind: 'type' })),
        { type: 'Identifier', name: 'runCursor' },
        helpers,
        config,
      ),
    ).toBeNull()
    expect(
      namedCursorImport(
        contextFor(importVariable('runCursor', 'ImportSpecifier', { declarationKind: 'type' })),
        { type: 'Identifier', name: 'runCursor' },
        helpers,
        config,
      ),
    ).toBeNull()
    const namespace = importVariable('db', 'ImportNamespaceSpecifier')
    const object: NodeLike = { type: 'Identifier', name: 'db' }
    const member: NodeLike = {
      type: 'MemberExpression',
      object,
      property: { type: 'Identifier', name: 'runCursor' },
      computed: false,
    }
    expect(namespaceCursorImport(contextFor(namespace), object, helpers, config)).toBe(true)
    expect(namespaceImportMember(contextFor(namespace), member, helpers, config)).toBe(member)
    expect(namespaceCursorMember(contextFor(namespace), member, helpers, config)).toBe('runCursor')
    expect(namespaceImportMember(contextFor(namespace), object, helpers, config)).toBeNull()
    expect(
      namespaceImportMember(
        contextFor(namespace),
        { type: 'MemberExpression', object: { type: 'Literal', value: 1 }, computed: false },
        helpers,
        config,
      ),
    ).toBeNull()
  })
})

describe('queryHead and wrappers', () => {
  it('reads literals, templates, sql tags, and rejects writes', () => {
    const sqlSpec: NodeLike = { type: 'ImportDefaultSpecifier', importKind: 'value' }
    const sqlDecl: NodeLike = {
      type: 'ImportDeclaration',
      importKind: 'value',
      source: { type: 'Literal', value: 'sql-template-strings' },
    }
    sqlSpec.parent = sqlDecl
    const sqlVar: VariableLike = {
      name: 'sql',
      defs: [{ type: 'ImportBinding', node: sqlSpec, parent: sqlDecl }],
      references: [{ identifier: { type: 'Identifier', name: 'sql' }, isWrite: () => false }],
    }
    const tagged: NodeLike = {
      type: 'TaggedTemplateExpression',
      tag: { type: 'Identifier', name: 'sql' },
      quasi: {
        type: 'TemplateLiteral',
        quasis: [{ value: { cooked: '/* rows */ SELECT 1', raw: '/* rows */ SELECT 1' } }],
      },
    }
    expect(queryHead(contextFor(sqlVar), tagged, helpers, config)).toBe('/* rows */ SELECT 1')
    sqlVar.references = [{ identifier: { type: 'Identifier', name: 'sql' }, isWrite: () => true }]
    expect(queryHead(contextFor(sqlVar), tagged, helpers, config)).toBeNull()
    sqlVar.references = [{ identifier: { type: 'Identifier', name: 'sql' }, isWrite: () => false }]
    const invalidCooked: NodeLike = {
      type: 'TaggedTemplateExpression',
      tag: { type: 'Identifier', name: 'sql' },
      quasi: { type: 'TemplateLiteral', quasis: [{ value: { cooked: null, raw: 'SELECT \\8' } }] },
    }
    expect(queryHead(contextFor(sqlVar), invalidCooked, helpers, config)).toBeNull()
    const typeSql = importVariable('sql', 'ImportDefaultSpecifier', {
      importKind: 'type',
      module: 'sql-template-strings',
    })
    const taggedSql = {
      type: 'TaggedTemplateExpression',
      tag: { type: 'Identifier', name: 'sql' },
    } satisfies NodeLike
    expect(queryHead(contextFor(typeSql), taggedSql, helpers, config)).toBeNull()
    expect(
      queryHead(
        contextFor(
          importVariable('sql', 'ImportDefaultSpecifier', {
            declarationKind: 'type',
            module: 'sql-template-strings',
          }),
        ),
        taggedSql,
        helpers,
        config,
      ),
    ).toBeNull()
    expect(
      queryHead(
        contextFor({
          name: 'sql',
          defs: [
            {
              type: 'ImportBinding',
              node: { type: 'ImportDefaultSpecifier', importKind: 'value' },
            },
          ],
          references: [],
        }),
        { type: 'TaggedTemplateExpression', tag: { type: 'Identifier', name: 'sql' } },
        helpers,
        config,
      ),
    ).toBeNull()
    expect(
      queryHead(
        contextFor(null),
        { type: 'Literal', value: '/* rows */ SELECT 1' },
        helpers,
        config,
      ),
    ).toBe('/* rows */ SELECT 1')
    expect(queryHead(contextFor(null), { type: 'Literal', value: 1 }, helpers, config)).toBeNull()
    expect(
      queryHead(
        contextFor(null),
        { type: 'TemplateLiteral', quasis: [{ value: { cooked: null, raw: 'SELECT 1' } }] },
        helpers,
        config,
      ),
    ).toBe('SELECT 1')
    expect(
      queryHead(
        contextFor(null),
        { type: 'TemplateLiteral', quasis: [{ value: {} }] },
        helpers,
        config,
      ),
    ).toBeNull()
    expect(
      queryHead(
        contextFor(null),
        { type: 'TaggedTemplateExpression', tag: { type: 'Literal', value: 'sql' } },
        helpers,
        config,
      ),
    ).toBeNull()
  })

  it('allows discarded appends and type-query references on a const binding', () => {
    const init: NodeLike = { type: 'Literal', value: '/* rows */ SELECT 1' }
    const id: NodeLike = { type: 'Identifier', name: 'statement' }
    const declarator: NodeLike = { type: 'VariableDeclarator', id, init }
    const declaration: NodeLike = { type: 'VariableDeclaration', kind: 'const' }
    declarator.parent = declaration
    const arg: NodeLike = { type: 'Identifier', name: 'statement' }
    const callee: NodeLike = { type: 'Identifier', name: 'runCursor' }
    const call: NodeLike = { type: 'CallExpression', callee, arguments: [arg] }
    arg.parent = call
    const importVar = importVariable('runCursor', 'ImportSpecifier')
    const statementVar: VariableLike = {
      name: 'statement',
      defs: [{ type: 'Variable', node: declarator }],
      references: [
        { identifier: id, isWrite: () => true },
        { identifier: arg, isWrite: () => false },
      ],
    }
    const mixed: RuleContextLike = {
      filename: 'src/a.js',
      options: [],
      report: () => {},
      sourceCode: {
        getScope: () => ({
          set: {
            get: (name) =>
              name === 'runCursor' ? importVar : name === 'statement' ? statementVar : undefined,
          },
          variables: [importVar, statementVar],
          upper: null,
        }),
      },
    }
    expect(queryHead(mixed, arg, helpers, config)).toBe('/* rows */ SELECT 1')
    const typeId: NodeLike = { type: 'Identifier', name: 'statement' }
    const typeQuery: NodeLike = { type: 'TSTypeQuery', exprName: typeId }
    typeId.parent = typeQuery
    statementVar.references.push({ identifier: typeId, isWrite: () => false })
    expect(queryHead(mixed, arg, helpers, config)).toBe('/* rows */ SELECT 1')
    expect(queryHead(mixed, { type: 'Identifier', name: 'missing' }, helpers, config)).toBeNull()
    const importOnly = importVariable('runCursor', 'ImportSpecifier')
    expect(
      queryHead(contextFor(importOnly), { type: 'Identifier', name: 'runCursor' }, helpers, config),
    ).toBeNull()
    const twoDefs: VariableLike = {
      name: 'statement',
      defs: [
        { type: 'Variable', node: declarator },
        { type: 'Variable', node: declarator },
      ],
      references: [],
    }
    expect(
      queryHead(contextFor(twoDefs), { type: 'Identifier', name: 'statement' }, helpers, config),
    ).toBeNull()
    expect(
      queryHead(
        contextFor(null),
        {
          type: 'TaggedTemplateExpression',
          tag: { type: 'Identifier', name: 'sql' },
          quasi: {
            type: 'TemplateLiteral',
            quasis: [{ value: { cooked: null, raw: 'SELECT 1' } }],
          },
        },
        helpers,
        config,
      ),
    ).toBeNull()
  })

  it('detects discarded append chains and type queries', () => {
    const object: NodeLike = { type: 'Identifier', name: 'query' }
    const member: NodeLike = {
      type: 'MemberExpression',
      object,
      property: { type: 'Identifier', name: 'append' },
    }
    const call: NodeLike = { type: 'CallExpression', callee: member, arguments: [] }
    const outerMember: NodeLike = {
      type: 'MemberExpression',
      object: call,
      property: { type: 'Identifier', name: 'append' },
    }
    const outer: NodeLike = { type: 'CallExpression', callee: outerMember, arguments: [] }
    const statement: NodeLike = { type: 'ExpressionStatement', expression: outer }
    object.parent = member
    member.parent = call
    call.parent = outerMember
    outerMember.parent = outer
    outer.parent = statement
    expect(isDiscardedSqlStatementAppend(object, helpers, transparentParent)).toBe(true)
    const assigned: NodeLike = { type: 'VariableDeclarator', init: call }
    call.parent = assigned
    expect(isDiscardedSqlStatementAppend(object, helpers, transparentParent)).toBe(false)
    const inner: NodeLike = { type: 'Identifier', name: 'runCursor' }
    const asNode: NodeLike = { type: 'TSAsExpression', expression: inner }
    inner.parent = asNode
    const callParent: NodeLike = { type: 'CallExpression', callee: asNode }
    asNode.parent = callParent
    expect(directCallParent(inner)).toBe(callParent)
    const qualified: NodeLike = { type: 'TSQualifiedName', left: inner }
    inner.parent = qualified
    const query: NodeLike = { type: 'TSTypeQuery' }
    qualified.parent = query
    expect(isTypeQuery(inner)).toBe(true)
    const computed: NodeLike = { type: 'Identifier', name: 'query' }
    const computedMember: NodeLike = {
      type: 'MemberExpression',
      object: computed,
      property: { type: 'Identifier', name: 'append' },
      computed: true,
    }
    computed.parent = computedMember
    expect(isDiscardedSqlStatementAppend(computed, helpers, transparentParent)).toBe(false)
    const dangling: NodeLike = { type: 'Identifier', name: 'query' }
    const danglingMember: NodeLike = {
      type: 'MemberExpression',
      object: dangling,
      property: { type: 'Identifier', name: 'append' },
      computed: false,
    }
    dangling.parent = danglingMember
    expect(isDiscardedSqlStatementAppend(dangling, helpers, transparentParent)).toBe(false)
    const otherCallee: NodeLike = {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: 'other' },
    }
    danglingMember.parent = otherCallee
    expect(isDiscardedSqlStatementAppend(dangling, helpers, transparentParent)).toBe(false)
  })
})

describe('firstQuasiText', () => {
  it('returns null when a template has no quasis or only raw text is unavailable', () => {
    expect(firstQuasiText(undefined, true)).toBeNull()
    expect(firstQuasiText({ type: 'TemplateLiteral', quasis: [] }, true)).toBeNull()
    expect(
      firstQuasiText(
        { type: 'TemplateLiteral', quasis: [{ value: { cooked: null, raw: 'x' } }] },
        false,
      ),
    ).toBeNull()
    expect(
      firstQuasiText(
        { type: 'TemplateLiteral', quasis: [{ value: { cooked: null, raw: 'x' } }] },
        true,
      ),
    ).toBe('x')
  })
})
