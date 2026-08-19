import { describe, expect, it } from 'vitest'
import { readPackageVersion } from './package-version.mts'

describe('readPackageVersion', () => {
  it('reads a string version', () => {
    expect(readPackageVersion({ version: '1.2.3' })).toBe('1.2.3')
  })

  it.each([null, {}, { version: 1 }])('rejects %j', (value) => {
    expect(() => readPackageVersion(value)).toThrow(/version/)
  })
})
