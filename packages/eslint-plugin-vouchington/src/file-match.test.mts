import { describe, expect, it } from 'vitest'

import type { RuleContextLike } from './ast-helpers.mts'
import { matchesFileGlobs, resolveFileMatchOptions, stringArray } from './file-match.mts'

describe('resolveFileMatchOptions', () => {
  it('returns defaults and rejects non-string arrays', () => {
    expect(resolveFileMatchOptions({})).toEqual({
      include: ['**/*.{ts,mts,tsx,js,mjs}'],
      exclude: [],
      includeFiles: [],
    })
    expect(resolveFileMatchOptions({ include: 'src' })).toBeNull()
    expect(resolveFileMatchOptions({ exclude: [1] })).toBeNull()
    expect(stringArray(undefined)).toBeUndefined()
    expect(stringArray('x')).toBeUndefined()
    expect(resolveFileMatchOptions({ include: ['src/**'], includeFiles: ['./lib/a.ts'] })).toEqual({
      include: ['src/**'],
      exclude: [],
      includeFiles: ['lib/a.ts'],
    })
  })
})

describe('matchesFileGlobs', () => {
  it('keeps includeFiles even when exclude matches', () => {
    const context = {
      filename: '/repo/src/kept.js',
      cwd: '/repo',
      options: [],
      report() {},
      sourceCode: { getScope: () => ({ variables: [], upper: null }) },
    } as RuleContextLike
    expect(
      matchesFileGlobs(context, {
        include: ['**/*.ts'],
        exclude: ['src/**'],
        includeFiles: ['src/kept.js'],
      }),
    ).toBe(true)
  })
})
