import type { LockObserverConfig, LockWaiterDiagnostic, ObserverPool } from './fault-types.mts'
import { runObservation } from './lock-wait.mts'
import { pollUntilNotNull } from './polling.mts'

/** A LIKE pattern matching `text` literally anywhere, so `%`, `_` and `\` in markers are not wildcards. */
function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`
}

const CLEAR_SNAPSHOT = 'SELECT pg_stat_clear_snapshot()'

const WAITER_SQL = `
  /* waitForTestPostgresLockWaiter */
  SELECT EXISTS (
    SELECT 1
    FROM pg_stat_activity activity
    WHERE activity.pid <> pg_backend_pid()
      AND ($1::integer IS NULL OR activity.pid = $1::integer)
      AND activity.state = 'active'
      AND activity.wait_event_type = 'Lock'
      AND activity.query LIKE $2::text
      AND $3::integer = ANY(pg_blocking_pids(activity.pid))
  ) AS waiting
`

const CHAIN_SQL = `
  /* waitForTestPostgresBlockedLockChain */
  SELECT EXISTS (
    SELECT 1
    FROM pg_stat_activity direct_waiter
    JOIN pg_stat_activity indirect_waiter
      ON direct_waiter.pid = ANY(pg_blocking_pids(indirect_waiter.pid))
    WHERE direct_waiter.pid <> pg_backend_pid()
      AND indirect_waiter.pid <> pg_backend_pid()
      AND direct_waiter.state = 'active'
      AND indirect_waiter.state = 'active'
      AND direct_waiter.wait_event_type = 'Lock'
      AND indirect_waiter.wait_event_type = 'Lock'
      AND direct_waiter.query LIKE $1::text
      AND $2::integer = ANY(pg_blocking_pids(direct_waiter.pid))
      AND indirect_waiter.query LIKE ANY($3::text[])
  ) AS waiting
`

/**
 * Waits until a query bearing `queryMarker` is blocked by this test's lock-holding backend.
 * Use a dedicated advisory executor when the held lock and blocked operations can occupy every
 * write connection; the observer must run before the holder is released. Passing a previously
 * acquired transaction executor reserves the observer connection before the holder or blocked
 * operation starts, and its transaction-local activity snapshot is discarded before each
 * observation. Supply `waiterProcessId` to distinguish this operation from other matching waiters.
 */
export async function waitForLockWaiter(
  config: LockObserverConfig,
  holderProcessId: number,
  queryMarker: string,
  observerPool: ObserverPool = 'write',
  onDiagnostic?: (diagnostic: LockWaiterDiagnostic) => void,
  signal?: AbortSignal,
  waiterProcessId?: number,
): Promise<void> {
  await pollUntilNotNull(
    async () => {
      signal?.throwIfAborted()
      if (typeof observerPool === 'function') {
        onDiagnostic?.({ phase: 'snapshot-clear-start', waiting: false })
        signal?.throwIfAborted()
        await observerPool({
          text: `/* waitForTestPostgresLockWaiter.refresh */ ${CLEAR_SNAPSHOT}`,
        })
        signal?.throwIfAborted()
        onDiagnostic?.({ phase: 'snapshot-cleared', waiting: false })
      }
      onDiagnostic?.({ phase: 'waiter-query-start', waiting: false })
      signal?.throwIfAborted()
      const { rows } = await runObservation<{ waiting: boolean }>(
        config,
        observerPool,
        WAITER_SQL,
        [waiterProcessId ?? null, likeContains(queryMarker), holderProcessId],
      )
      signal?.throwIfAborted()
      onDiagnostic?.({ phase: 'waiter-query', waiting: rows[0]?.waiting ?? false })
      return rows[0]?.waiting ? true : null
    },
    config.timeoutMs ?? 5_000,
    config.intervalMs ?? 10,
  ).catch((err) => {
    const cause =
      signal?.aborted && err !== signal.reason
        ? new SuppressedError(err, signal.reason, 'Lock observation failed during cancellation')
        : err
    throw new Error(`Operation did not wait for the test lock: ${queryMarker}`, { cause })
  })
}

/**
 * Waits until one backend is blocked by `holderProcessId` on `directQueryMarker` and a second
 * backend is blocked by that first backend on one of `blockedByDirectQueryMarkers`.
 *
 * Use this when the second operation cannot reach the holder's lock because the first operation
 * already holds a conflicting row lock. `pg_blocking_pids` reports only the direct blocker, so
 * the second wait is the transitive link.
 */
export async function waitForBlockedLockChain(
  config: LockObserverConfig,
  holderProcessId: number,
  directQueryMarker: string,
  blockedByDirectQueryMarkers: readonly string[],
  observerPool: ObserverPool = 'advisoryLock',
): Promise<void> {
  await pollUntilNotNull(
    async () => {
      if (typeof observerPool === 'function')
        await observerPool({
          text: `/* waitForTestPostgresBlockedLockChain.refresh */ ${CLEAR_SNAPSHOT}`,
        })
      const { rows } = await runObservation<{ waiting: boolean }>(config, observerPool, CHAIN_SQL, [
        likeContains(directQueryMarker),
        holderProcessId,
        blockedByDirectQueryMarkers.map(likeContains),
      ])
      return rows[0]?.waiting ? true : null
    },
    config.timeoutMs ?? 5_000,
    config.intervalMs ?? 10,
  ).catch((err) => {
    throw new Error(
      `Operations did not form a lock chain behind the test holder: ${directQueryMarker}`,
      { cause: err },
    )
  })
}
