import { describe, expect, it } from 'vitest'
import { collectCreatePageLiterals } from './create-page-literals.mts'

describe('create-page object spreads', () => {
  it('rejects dynamic leading spreads that leave configured fields uncovered', () => {
    expect(() =>
      collectCreatePageLiterals("const fields = { ...defaults, action: 'entry' }", 'page.ts', [
        'action',
        'unionType',
      ]),
    ).toThrow('cannot be inspected through a leading spread')
    expect(() =>
      collectCreatePageLiterals("const view = <Form {...defaults} action='entry' />", 'page.tsx', [
        'action',
        'unionType',
      ]),
    ).toThrow('cannot be inspected through a leading spread')
    expect(() =>
      collectCreatePageLiterals(
        "const fields = { ...{ ...defaults, action: 'entry' } }",
        'page.ts',
        ['action', 'unionType'],
      ),
    ).toThrow('cannot be inspected through a leading spread')
  })

  it('accepts fully replaced dynamic fields and preserves static inline spread extraction', () => {
    expect(
      collectCreatePageLiterals(
        "const fields = { ...defaults, action: 'entry', unionType: 'entry' }",
        'page.ts',
        ['action', 'unionType'],
      ),
    ).toEqual(['entry', 'entry'])
    expect(
      collectCreatePageLiterals(
        "const fields = { ...{ action: 'wrong', unionType: 'type' }, action: 'entry' }",
        'page.ts',
        ['action', 'unionType'],
      ),
    ).toEqual(['type', 'entry'])
  })
})
