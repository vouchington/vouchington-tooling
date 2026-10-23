import { describe, expect, it } from 'vitest'
import { pollUntilNotNull } from './polling.mts'

describe('pollUntilNotNull', () => {
  it('returns the first non-null value', async () => {
    let calls = 0
    const value = await pollUntilNotNull(async () => (++calls < 3 ? null : 'ready'), 1000, 1)
    expect(value).toBe('ready')
  })

  it('takes one last reading at the deadline', async () => {
    expect(await pollUntilNotNull(async () => 'late', 0)).toBe('late')
  })

  it('throws a described timeout', async () => {
    await expect(pollUntilNotNull(async () => undefined, 5, 1, 'the row')).rejects.toThrow(
      'Timed out waiting for the row (after 5ms)',
    )
    await expect(pollUntilNotNull(async () => null, 0)).rejects.toThrow('a non-null value')
  })
})
