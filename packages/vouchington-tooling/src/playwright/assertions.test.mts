import { describe, expect, it } from 'vitest'
import { requireTestValue } from './assertions.mts'

describe('requireTestValue', () => {
  it('throws the provided error for null', () => {
    expect(() => requireTestValue(null, 'missing sidebar peer')).toThrowError(
      new Error('missing sidebar peer'),
    )
  })

  it('throws the provided error for undefined', () => {
    expect(() => requireTestValue(undefined, 'missing navbar box')).toThrowError(
      new Error('missing navbar box'),
    )
  })

  it('preserves falsy values and object identity', () => {
    const object = { id: 'sidebar-peer' }

    expect(requireTestValue(false, 'missing false')).toBe(false)
    expect(requireTestValue(0, 'missing zero')).toBe(0)
    expect(requireTestValue('', 'missing empty string')).toBe('')
    expect(requireTestValue(object, 'missing object')).toBe(object)
  })
})
