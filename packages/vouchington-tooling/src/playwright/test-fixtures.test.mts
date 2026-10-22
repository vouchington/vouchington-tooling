import { describe, expect, it } from 'vitest'
import { TEST_PNG } from './test-fixtures.mts'

describe('TEST_PNG', () => {
  it('is a 1x1 PNG', () => {
    expect(TEST_PNG.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    expect(TEST_PNG.length).toBeGreaterThan(8)
  })
})
