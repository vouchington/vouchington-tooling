import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, expect, it } from 'vitest'
import { bindPoolObservationScope } from './observation-queue.mts'
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

describe('bindPoolObservationScope', () => {
  it('runs a callback outside any observation as is', () => {
    expect(bindPoolObservationScope()(() => 7)).toBe(7)
  })

  it('makes nested instrumentation reject while keeping the caller stores', async () => {
    const caller = new AsyncLocalStorage<string>()
    let bound!: ReturnType<typeof bindPoolObservationScope>
    await runPoolObservationExclusively(async () => {
      bound = bindPoolObservationScope()
    })
    const inside = await runPoolObservationExclusively(async () => {
      const run = bindPoolObservationScope()
      return caller.run('request-1', () =>
        run(async () => ({
          store: caller.getStore(),
          nested: await runPoolObservationExclusively(async () => 'ran').catch(
            (e: Error) => e.message,
          ),
        })),
      )
    })
    expect(inside).toEqual({
      store: 'request-1',
      nested: 'PostgreSQL pool instrumentation cannot be nested',
    })
    expect(bound(() => 'late')).toBe('late')
  })
})
