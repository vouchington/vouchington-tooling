import { describe, expect, it } from 'vitest'

import type { NodeLike, RuleContextLike, VariableLike } from './ast-helpers.mts'
import {
  isNamedImport,
  isNamespaceImport,
  normalizeRequireLoader,
  requiredModuleSpecifier,
} from './factory-owner-require.mts'

function contextWithImport(imported: NodeLike, source = 'typescript'): RuleContextLike {
  const specifier: NodeLike = {
    type: 'ImportSpecifier',
    importKind: 'value',
    imported,
  }
  const declaration: NodeLike = {
    type: 'ImportDeclaration',
    importKind: 'value',
    source: { type: 'Literal', value: source },
  }
  specifier.parent = declaration
  const variable: VariableLike = {
    name: 'createProgram',
    defs: [{ type: 'ImportBinding', node: specifier, parent: declaration }],
    references: [],
  }
  return {
    filename: 'src/a.js',
    options: [],
    report() {},
    sourceCode: {
      getScope: () => ({
        variables: [variable],
        set: { get: (name) => (name === 'createProgram' ? variable : undefined) },
        upper: null,
      }),
    },
  }
}

describe('factory-owner-require', () => {
  it('reads import specifiers from name or value fields', () => {
    const identifier: NodeLike = { type: 'Identifier', name: 'createProgram' }
    expect(
      isNamedImport(
        contextWithImport({ type: 'Identifier', name: 'createProgram' }),
        identifier,
        new Set(['typescript']),
        'createProgram',
      ),
    ).toBe(true)
    expect(
      isNamedImport(
        contextWithImport({ type: 'Identifier', value: 'createProgram' }),
        identifier,
        new Set(['typescript']),
        'createProgram',
      ),
    ).toBe(true)
    expect(
      isNamedImport(
        contextWithImport({ type: 'Identifier' }),
        identifier,
        new Set(['typescript']),
        'createProgram',
      ),
    ).toBe(false)
  })

  it('reads the import declaration from the specifier parent when the def has none', () => {
    const specifier: NodeLike = {
      type: 'ImportSpecifier',
      importKind: 'value',
      imported: { type: 'Identifier', name: 'createProgram' },
    }
    const declaration: NodeLike = {
      type: 'ImportDeclaration',
      importKind: 'value',
      source: { type: 'Literal', value: 'typescript' },
    }
    specifier.parent = declaration
    const variable: VariableLike = {
      name: 'createProgram',
      defs: [{ type: 'ImportBinding', node: specifier }],
      references: [],
    }
    const context: RuleContextLike = {
      filename: 'src/a.js',
      options: [],
      report() {},
      sourceCode: {
        getScope: () => ({
          variables: [variable],
          set: { get: (name) => (name === 'createProgram' ? variable : undefined) },
          upper: null,
        }),
      },
    }
    expect(
      isNamedImport(
        context,
        { type: 'Identifier', name: 'createProgram' },
        new Set(['typescript']),
        'createProgram',
      ),
    ).toBe(true)
  })

  it('ignores non-call receivers and non-string require arguments', () => {
    const context = contextWithImport({ type: 'Identifier', name: 'createProgram' })
    expect(
      isNamedImport(
        context,
        {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'namespace' },
          property: { type: 'Identifier', name: 'createProgram' },
        },
        new Set(['typescript']),
        'createProgram',
      ),
    ).toBe(false)
    expect(requiredModuleSpecifier(context, { type: 'Identifier', name: 'require' })).toBeNull()
    expect(
      requiredModuleSpecifier(context, {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'require' },
        arguments: [{ type: 'Literal', value: 1 }],
      }),
    ).toBeNull()
  })

  it('ignores type-only import-equals namespace bindings', () => {
    const variable: VariableLike = {
      name: 'runtime',
      defs: [
        {
          type: 'ImportBinding',
          node: {
            type: 'TSImportEqualsDeclaration',
            importKind: 'type',
            moduleReference: {
              type: 'TSExternalModuleReference',
              expression: { type: 'Literal', value: '@compiler/runtime' },
            },
          },
        },
      ],
      references: [],
    }
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report() {},
      sourceCode: { getScope: () => ({ variables: [variable], upper: null }) },
    }
    expect(
      isNamespaceImport(
        context,
        { type: 'Identifier', name: 'runtime' },
        new Set(['@compiler/runtime']),
      ),
    ).toBe(false)
  })

  it('resolves a qualified createRequire import-equals alias', () => {
    const nodeModule: VariableLike = {
      name: 'nodeModule',
      defs: [
        {
          type: 'ImportBinding',
          node: {
            type: 'TSImportEqualsDeclaration',
            moduleReference: {
              type: 'TSExternalModuleReference',
              expression: { type: 'Literal', value: 'node:module' },
            },
          },
        },
      ],
      references: [],
    }
    const loadFactory: VariableLike = {
      name: 'loadFactory',
      defs: [
        { type: 'ImportBinding', node: { type: 'Identifier' } },
        { type: 'ImportBinding', node: { type: 'TSImportEqualsDeclaration', importKind: 'type' } },
        {
          type: 'ImportBinding',
          node: {
            type: 'TSImportEqualsDeclaration',
            moduleReference: {
              type: 'TSQualifiedName',
              left: { type: 'Identifier', name: 'nodeModule' },
              right: { type: 'Identifier', name: 'createRequire' },
            },
          },
        },
      ],
      references: [],
    }
    const variables = new Map([
      ['nodeModule', nodeModule],
      ['loadFactory', loadFactory],
      [
        'otherFactory',
        {
          name: 'otherFactory',
          defs: [
            {
              type: 'ImportBinding',
              node: {
                type: 'TSImportEqualsDeclaration',
                moduleReference: {
                  type: 'TSQualifiedName',
                  left: { type: 'Identifier', name: 'nodeModule' },
                  right: { type: 'Identifier', name: 'other' },
                },
              },
            },
          ],
          references: [],
        } satisfies VariableLike,
      ],
    ])
    const context: RuleContextLike = {
      filename: 'src/check.ts',
      options: [],
      report() {},
      sourceCode: {
        getScope: () => ({ set: { get: (name) => variables.get(name) }, upper: null }),
      },
    }
    expect(normalizeRequireLoader(undefined)).toBeUndefined()
    expect(
      requiredModuleSpecifier(context, {
        type: 'CallExpression',
        callee: {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'loadFactory' },
          arguments: [{ type: 'Literal', value: '/workspace/file.js' }],
        },
        arguments: [{ type: 'Literal', value: '@compiler/runtime' }],
      }),
    ).toBe('@compiler/runtime')
    expect(
      requiredModuleSpecifier(context, {
        type: 'CallExpression',
        callee: {
          type: 'CallExpression',
          callee: { type: 'Identifier', name: 'otherFactory' },
          arguments: [{ type: 'Literal', value: '/workspace/file.js' }],
        },
        arguments: [{ type: 'Literal', value: '@compiler/runtime' }],
      }),
    ).toBeNull()
  })
})
