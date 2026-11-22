import { AsyncLocalStorage } from 'node:async_hooks'

const observationScope = new AsyncLocalStorage<{ active: boolean }>()
const poolObservationQueue = { tail: Promise.resolve() }

/**
 * Captures the current observation marker so a callback can later run inside it while keeping
 * every other async-local store of its caller; a nested instrumentation helper then rejects.
 */
export function bindPoolObservationScope(): <Result>(run: () => Result) => Result {
  const context = observationScope.getStore()
  return (run) => (context ? observationScope.run(context, run) : run())
}

/** Serializes pool instrumentation so two fault scopes never wrap the same pool at once. */
export async function runPoolObservationExclusively<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  if (observationScope.getStore()?.active)
    throw new Error('PostgreSQL pool instrumentation cannot be nested')
  const previousObservation = poolObservationQueue.tail
  let releaseObservation!: () => void
  poolObservationQueue.tail = new Promise((resolve) => {
    releaseObservation = resolve
  })
  await previousObservation
  const context = { active: true }
  try {
    return await observationScope.run(context, operation)
  } finally {
    context.active = false
    releaseObservation()
  }
}
