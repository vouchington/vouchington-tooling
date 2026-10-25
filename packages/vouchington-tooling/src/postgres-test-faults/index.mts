export { withPostgresPoolQueryFailureForTest } from './pool-query-failure.mts'
export { withPostgresQueryFailureForTest } from './query-failure.mts'
/**
 * Runs `operation` while holding the package-wide queue that serializes `pg.Pool` instrumentation.
 * `withPostgresQueryFailureForTest` and `withPostgresPoolQueryFailureForTest` already use it, so
 * their scopes never wrap the same pool at once. Wrap your own fault injection or lock observation
 * in it when it patches or watches a pool and may overlap those helpers. Callers wait their turn in
 * arrival order; the next one starts when `operation` settles, even if it rejects. Calling it from
 * inside `operation` (nesting) rejects instead of deadlocking.
 */
export { runPoolObservationExclusively } from './observation-queue.mts'
export { createPostgresLockObservers, type PostgresLockObservers } from './lock-observers.mts'
export { getTestPostgresBackendProcessId } from './lock-wait.mts'
export type {
  FaultCommand,
  LockObserverConfig,
  LockWaiterDiagnostic,
  ObserverPool,
  PollOptions,
  PostgresFaultOptions,
  PostgresFaultResult,
  QueryExecutor,
} from './fault-types.mts'
