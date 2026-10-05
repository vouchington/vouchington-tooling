import { describe, expect, it } from 'vitest'
import { collectCreatePageLiterals } from './create-page-literals.mts'

describe('create-page literal extraction', () => {
  it('rejects setter keys and accepts computed own __proto__ properties', () => {
    for (const key of ['__proto__', "'__proto__'"]) {
      expect(() =>
        collectCreatePageLiterals(`const fields = { ${key}: 'entry' }`, 'page.ts', ['__proto__']),
      ).toThrow('prototype setter')
    }
    expect(
      collectCreatePageLiterals("const fields = { ['__proto__']: 'entry' }", 'page.ts', [
        '__proto__',
      ]),
    ).toEqual(['entry'])
  })

  it('rejects updates and deletion of configured properties', () => {
    for (const update of ['form.action++', 'form.action--', '++form.action', "--form['action']"]) {
      expect(() =>
        collectCreatePageLiterals(`const form: any = { action: 'entry' }; ${update}`, 'page.ts', [
          'action',
        ]),
      ).toThrow('unary mutation')
    }
    expect(() =>
      collectCreatePageLiterals(
        "const form: any = { action: 'entry' }; delete form.action",
        'page.ts',
        ['action'],
      ),
    ).toThrow('deletion')
    expect(
      collectCreatePageLiterals("form.unrelated++; const fields = { action: 'entry' }", 'page.ts', [
        'action',
      ]),
    ).toEqual(['entry'])
  })
})
