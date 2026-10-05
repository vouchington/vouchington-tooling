import { expect, it } from 'vitest'
import ts from '@typescript/typescript6'

import { collectCreatePageLiterals } from './create-page-literals.mts'
import { jsxRuntimeAttributeStringValue, jsxRuntimeStringValue } from './create-page-jsx.mts'

it('decodes static JSX create-page entities using TypeScript runtime semantics', () => {
  expect(collectCreatePageLiterals('<Form action="&#101;ntry" />', 'page.tsx', ['action'])).toEqual(
    ['entry'],
  )
  expect(collectCreatePageLiterals('<Form action="&amp;entry" />', 'page.tsx', ['action'])).toEqual(
    ['&entry'],
  )
})

it('fails closed when JSX entity decoding cannot find a runtime attribute', () => {
  const source = ts.createSourceFile(
    'input.tsx',
    'const value = "entry"',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const findStringLiteral = (): ts.StringLiteral => {
    let value: ts.StringLiteral | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node)) value = node
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!value) throw new Error('test fixture has no string literal')
    return value
  }
  const value = findStringLiteral()
  expect(() =>
    jsxRuntimeStringValue(
      value,
      ts.createSourceFile('wrong.tsx', '', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
      'wrong.tsx',
    ),
  ).toThrow('wrong.tsx: could not decode JSX create-page value')
  expect(() =>
    jsxRuntimeAttributeStringValue(
      ts.createSourceFile(
        'missing-action.js',
        'const element = _jsx("div", { type: "entry" })',
        ts.ScriptTarget.Latest,
        true,
      ),
      'missing-action.js',
    ),
  ).toThrow('missing-action.js: could not decode JSX create-page value')
})
