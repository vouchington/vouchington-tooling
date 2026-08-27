import { describe, expect, it } from 'vitest'
import { mapBounded } from './concurrency.mts'

describe('mapBounded', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid limit: %s',
    async (limit) => {
      await expect(mapBounded([], limit, async () => {})).rejects.toThrow('concurrency limit')
    },
  )

  it('limits concurrent actions', async () => {
    let active = 0
    let maximum = 0
    await mapBounded(Array.from({ length: 11 }), 10, async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
    })
    expect(maximum).toBe(10)
  })

  it('waits for active actions before reporting a failure', async () => {
    const failure = new Error('failed')
    let completed = false
    await expect(
      mapBounded([0, 1], 2, async (value) => {
        if (value === 0) throw failure
        await new Promise<void>((resolve) => setImmediate(resolve))
        completed = true
      }),
    ).rejects.toBe(failure)
    expect(completed).toBe(true)
  })
})
