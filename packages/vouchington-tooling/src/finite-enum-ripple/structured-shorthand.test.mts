import { describe, expect, it } from 'vitest'
import { parseStructuredTypeEntries } from './parsers.mts'

describe('structured type shorthand properties', () => {
  it('rejects shorthand entries while preserving excluded methods and accessors', () => {
    expect(() =>
      parseStructuredTypeEntries(
        "const alpha = { slug: 'alpha', slugs: 'alphas' }; const kinds = { alpha, beta: { slug: 'beta', slugs: 'betas' } }",
        'src/kinds.ts',
        'kinds',
        'slug',
        'slugs',
      ),
    ).toThrow('kinds.alpha must be an object literal')
    expect(
      parseStructuredTypeEntries(
        "const kinds = { alpha: { slug: 'alpha', slugs: 'alphas' }, ignored() { return null }, get also() { return null } }",
        'src/kinds.ts',
        'kinds',
        'slug',
        'slugs',
      ),
    ).toEqual([{ value: 'alpha', slug: 'alpha', slugPlural: 'alphas' }])
  })
})
