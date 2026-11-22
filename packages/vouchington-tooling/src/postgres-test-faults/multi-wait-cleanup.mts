import type { TestPostgresMultiWaitState } from './multi-wait-types.mts'

/** Releases every holder first, then drains its operations and restores every borrowed client. */
export async function cleanupTestPostgresMultiWait(input: {
  states: TestPostgresMultiWaitState[]
  releaseHolder: (state: TestPostgresMultiWaitState) => Promise<void>
  restorePool: () => void
  hasPrimaryFailure: () => boolean
  primaryFailure: () => unknown
  closedReason: Error
}): Promise<void> {
  const { states } = input
  const failures = new Set<unknown>()
  const releases = await Promise.allSettled(states.map(input.releaseHolder))
  for (const result of releases) if (result.status === 'rejected') failures.add(result.reason)

  const starts = await Promise.allSettled(states.map((state) => state.started))
  for (const result of starts)
    if (
      result.status === 'rejected' &&
      result.reason !== input.closedReason &&
      result.reason !== input.primaryFailure()
    )
      failures.add(result.reason)

  const operations = await Promise.allSettled(
    states.flatMap((state) => (state.operation ? [state.operation] : [])),
  )
  await Promise.allSettled(
    states.flatMap((state) =>
      [state.observerLoan?.ready, state.setup, state.pendingConnect, state.snapshot].filter(
        (value) => value !== undefined,
      ),
    ),
  )

  for (const state of states) {
    if (state.loan) {
      try {
        await state.loan.dispose()
      } catch (err) {
        failures.add(err)
      }
    }
  }
  try {
    input.restorePool()
  } catch (err) {
    failures.add(err)
  }

  const observerReleases = await Promise.allSettled(
    states.flatMap((state) =>
      state.observerLoan
        ? [state.observerLoan.release(input.hasPrimaryFailure() || failures.size > 0)]
        : [],
    ),
  )
  for (const result of observerReleases)
    if (result.status === 'rejected') failures.add(result.reason)

  if (input.hasPrimaryFailure() || failures.size > 0)
    for (const result of operations)
      if (
        result.status === 'rejected' &&
        result.reason !== input.closedReason &&
        result.reason !== input.primaryFailure()
      )
        failures.add(result.reason)

  if (failures.size)
    throw new AggregateError([...failures], 'Owned PostgreSQL actions and cleanup failed', {
      cause: failures.values().next().value,
    })
}
