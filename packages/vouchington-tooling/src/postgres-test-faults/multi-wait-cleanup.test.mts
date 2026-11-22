import { describe, expect, it } from 'vitest'
import { cleanupTestPostgresMultiWait } from './multi-wait-cleanup.mts'
import type { TestPostgresMultiWaitState } from './multi-wait-types.mts'

const closedReason = new Error('closed')
const primary = new Error('primary')

function state(overrides: Record<string, unknown> = {}) {
  return {
    started: Promise.resolve(),
    witnessed: false,
    ...overrides,
  } as never as TestPostgresMultiWaitState
}
const run = (
  states: TestPostgresMultiWaitState[],
  overrides: Partial<Parameters<typeof cleanupTestPostgresMultiWait>[0]> = {},
) =>
  cleanupTestPostgresMultiWait({
    states,
    releaseHolder: async () => undefined,
    restorePool: () => undefined,
    hasPrimaryFailure: () => false,
    primaryFailure: () => primary,
    closedReason,
    ...overrides,
  })
const failuresOf = async (promise: Promise<void>) =>
  ((await promise.catch((e: unknown) => e)) as AggregateError).errors

describe('cleanupTestPostgresMultiWait', () => {
  it('resolves when everything settles cleanly', async () => {
    const calls: string[] = []
    await run([
      state({
        operation: Promise.resolve(),
        loan: { dispose: async () => void calls.push('dispose') },
        observerLoan: { ready: Promise.resolve(), release: async () => void calls.push('release') },
      }),
    ])
    expect(calls).toEqual(['dispose', 'release'])
  })

  it('collects every failure kind but skips the primary and closed reasons', async () => {
    const release = new Error('release')
    const start = new Error('start')
    const dispose = new Error('dispose')
    const restore = new Error('restore')
    const observer = new Error('observer')
    const errors = await failuresOf(
      run(
        [
          state({
            started: Promise.reject(start),
            loan: { dispose: () => Promise.reject(dispose) },
          }),
          state({ started: Promise.reject(closedReason) }),
          state({ started: Promise.reject(primary) }),
          state({
            observerLoan: { ready: Promise.resolve(), release: () => Promise.reject(observer) },
          }),
        ],
        {
          releaseHolder: () => Promise.reject(release),
          restorePool: () => {
            throw restore
          },
        },
      ),
    )
    expect(errors).toEqual([release, start, dispose, restore, observer])
  })

  it('adds rejected operations only when something else already failed', async () => {
    const operation = new Error('operation')
    await expect(run([state({ operation: Promise.reject(operation) })])).resolves.toBeUndefined()

    const errors = await failuresOf(
      run(
        [
          state({ operation: Promise.reject(operation) }),
          state({ operation: Promise.reject(closedReason) }),
          state({ operation: Promise.reject(primary) }),
        ],
        { hasPrimaryFailure: () => true },
      ),
    )
    expect(errors).toEqual([operation])

    const viaFailure = await failuresOf(
      run([state({ operation: Promise.reject(operation) })], {
        restorePool: () => {
          throw new Error('restore')
        },
      }),
    )
    expect(viaFailure).toHaveLength(2)
  })
})
