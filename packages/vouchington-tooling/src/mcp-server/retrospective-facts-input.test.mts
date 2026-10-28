import { describe, expect, it } from 'vitest'
import { checkFactsInput, prNumber } from './retrospective-facts-input.mts'

describe('prNumber', () => {
  it('accepts a digit string or a positive safe integer and normalizes to digits', () => {
    expect(prNumber('12')).toBe('12')
    expect(prNumber(12)).toBe('12')
  })

  it('rejects everything else', () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1a', 'https://x/pull/1', null])
      expect(prNumber(value)).toBeUndefined()
  })

  it('lets a numeric pr through the live selector check', () => {
    expect(checkFactsInput({ pr: 7 })).toBe(true)
    expect(() => checkFactsInput({ pr: 0 })).toThrow('compose.facts.pr must be a pull request')
  })
})
