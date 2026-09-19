import { describe, expect, it } from 'vitest'

import { parsePnpmLicenseReport } from './report.mts'

describe('parsePnpmLicenseReport', () => {
  it('validates and preserves package entries', () => {
    expect(parsePnpmLicenseReport({ MIT: [{ name: 'example', versions: ['1.0.0'] }] })).toEqual({
      MIT: [{ name: 'example', versions: ['1.0.0'] }],
    })
    expect(parsePnpmLicenseReport({ MIT: [{ name: 'example' }] })).toEqual({
      MIT: [{ name: 'example' }],
    })
  })

  it('preserves a prototype-shaped license group as report data', () => {
    const report = parsePnpmLicenseReport(
      JSON.parse('{"__proto__":[{"name":"example"}]}') as unknown,
    )
    expect(Object.entries(report)).toEqual([['__proto__', [{ name: 'example' }]]])
    expect(Object.getPrototypeOf(report)).toBeNull()
  })

  it.each([
    [null, /expected a JSON object/],
    [[], /expected a JSON object/],
    [{ MIT: {} }, /license group "MIT" to be an array/],
    [{ MIT: ['example'] }, /entry 0 to be an object/],
    [{ MIT: [{}] }, /entry 0\.name to be a string/],
    [{ MIT: [{ name: 'example', versions: '1.0.0' }] }, /versions to be an array of strings/],
    [{ MIT: [{ name: 'example', versions: [1] }] }, /versions to be an array of strings/],
  ])('rejects malformed report value %#', (value, message) => {
    expect(() => parsePnpmLicenseReport(value)).toThrow(message)
  })
})
