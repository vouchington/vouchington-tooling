import { describe, expect, it } from 'vitest'
import { runPoolObservationExclusively } from './index.mts'

describe('runPoolObservationExclusively', () => {
  it('serializes concurrent callers in arrival order', async () => {
    const events: string[] = []
    const run = (name: string, ms: number) =>
      runPoolObservationExclusively(async () => {
        events.push(`${name}:start`)
        await new Promise((resolve) => setTimeout(resolve, ms))
        events.push(`${name}:end`)
        return name
      })
    const results = await Promise.all([run('a', 20), run('b', 0)])
    expect(results).toEqual(['a', 'b'])
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('releases the queue after a rejection', async () => {
    await expect(
      runPoolObservationExclusively(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await runPoolObservationExclusively(async () => 'next')).toBe('next')
  })

  it('rejects nested use instead of deadlocking', async () => {
    await expect(
      runPoolObservationExclusively(() => runPoolObservationExclusively(async () => 1)),
    ).rejects.toThrow('cannot be nested')
  })
})
