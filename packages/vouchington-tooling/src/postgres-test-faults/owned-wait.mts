import { AsyncLocalStorage } from 'node:async_hooks'
import type pg from 'pg'
import { onTestFinished } from 'vitest'
import { createTestPostgresClientLoan, reserveTestPostgresObserver } from './client-loan.mts'
import {
  assertTestOwnedPostgresWait,
  getTestOwnedPostgresLock,
  type TestHeldPostgresLock,
  type TestOwnedPostgresWaitOptions,
} from './lock-identity.mts'
import { runPoolObservationExclusively } from './observation-queue.mts'
import { installTestOwnedPostgresPoolProxy } from './owned-wait-pool-proxy.mts'

const actionScope = new AsyncLocalStorage<object>()

/**
 * Observes every Promise or callback checkout of `options.pool` made by this action, or by the
 * request `options.requestId` owns, until the target wait: the waiter must queue behind the
 * holder's real lock, proven by PostgreSQL's own lock-wait notice and `pg_locks` snapshot.
 * `action` receives `waitForLock(operation)` and must call it exactly once with the operation that
 * waits. Cleanup runs on return or when the test finishes, whichever comes first.
 */
export async function withTestOwnedPostgresWait<Result>(
  options: TestOwnedPostgresWaitOptions,
  action: (waitForLock: (operation: Promise<unknown>) => Promise<void>) => Promise<Result>,
): Promise<Result> {
  const { pool } = options
  const token = {}
  const cancelled = Promise.withResolvers<never>()
  const captured = Promise.withResolvers<ReturnType<typeof createTestPostgresClientLoan>>()
  const operationRegistered = Promise.withResolvers<{
    outcome: Promise<PromiseSettledResult<unknown>[]>
  }>()
  void cancelled.promise.catch(() => {})
  void captured.promise.catch(() => {})
  void operationRegistered.promise.catch(() => {})
  const closedReason = new Error('Owned PostgreSQL observation closed before completion')
  let closed = false
  let entered = false
  let cleanupReported = false
  let observerLoan: ReturnType<typeof reserveTestPostgresObserver> | undefined
  let setup: Promise<TestHeldPostgresLock> | undefined
  const pendingConnects: Promise<pg.PoolClient>[] = []
  const loans: ReturnType<typeof createTestPostgresClientLoan>[] = []
  let operationOutcome: Promise<PromiseSettledResult<unknown>[]> | undefined
  let callbackOutcome: Promise<PromiseSettledResult<Result>[]> | undefined
  let snapshot: Promise<void> | undefined
  let restorePool: (() => void) | undefined
  let holderRelease: Promise<void> | undefined
  let cleaning: Promise<void> | undefined
  let primary: { reason: unknown } | undefined
  let witnessed = false
  function requireOpen() {
    if (closed) throw closedReason
  }
  const releaseHolder = () => (holderRelease ??= Promise.resolve().then(options.releaseHolder))
  const cleanup = () => {
    closed = true
    cancelled.reject(closedReason)
    captured.reject(closedReason)
    operationRegistered.reject(closedReason)
    return (cleaning ??= (async () => {
      const failures = new Set<unknown>()
      try {
        await releaseHolder()
      } catch (err) {
        failures.add(err)
      }
      const callbackResults = (await callbackOutcome) ?? []
      const operationResults = (await operationOutcome) ?? []
      for (const result of callbackResults)
        if (result.status === 'rejected' && result.reason !== closedReason)
          failures.add(result.reason)
      await Promise.allSettled([observerLoan?.ready, setup, ...pendingConnects, snapshot])
      const disposals = await Promise.allSettled(loans.map((loan) => loan.dispose()))
      for (const result of disposals) if (result.status === 'rejected') failures.add(result.reason)
      try {
        restorePool?.()
      } catch (err) {
        failures.add(err)
      }
      try {
        await observerLoan?.release(Boolean(primary || failures.size))
      } catch (err) {
        failures.add(err)
      }
      if (primary || failures.size)
        for (const result of operationResults)
          if (result.status === 'rejected' && result.reason !== closedReason)
            failures.add(result.reason)
      if (primary) failures.delete(primary.reason)
      if (failures.size)
        throw new AggregateError(
          [...(primary ? [primary.reason] : []), ...failures],
          'Owned PostgreSQL action and cleanup failed',
          { cause: failures.values().next().value },
        )
    })())
  }
  const dispose = async () => {
    try {
      await cleanup()
    } finally {
      cleanupReported = true
    }
  }
  onTestFinished(() => (cleanupReported ? undefined : dispose()))
  async function waitForLock(operation: Promise<unknown>): Promise<void> {
    if (operationOutcome) throw new Error('Owned PostgreSQL action was registered more than once')
    operationOutcome = Promise.allSettled([operation])
    operationRegistered.resolve({ outcome: operationOutcome })
    const settledEarly = operationOutcome.then(([result]) => {
      if (result?.status === 'rejected') throw result.reason
      throw new Error('Owned action settled without its native lock wait')
    })
    const observed = await Promise.race([captured.promise, settledEarly, cancelled.promise])
    const observer = observerLoan?.client
    if (closed || !observer) throw closedReason
    const { processId } = await observed.ready
    snapshot = assertTestOwnedPostgresWait(
      observer,
      processId,
      options.holderProcessId,
      options.queryMarker,
    )
    await snapshot
    witnessed = true
  }
  try {
    return await runPoolObservationExclusively(async () => {
      entered = true
      try {
        requireOpen()
        observerLoan = reserveTestPostgresObserver(options.observerPool)
        const reservedObserver = await observerLoan.ready
        requireOpen()
        setup = getTestOwnedPostgresLock(reservedObserver, options)
        const targetLock = await setup
        requireOpen()
        restorePool = installTestOwnedPostgresPoolProxy({
          pool,
          actionScope,
          token,
          requestId: options.requestId,
          isOwnedRequest: options.isOwnedRequest,
          notice: options.notice,
          requireOpen,
          isClosed: () => closed,
          closedReason,
          targetLock,
          operationRegistered: operationRegistered.promise,
          captured,
          pendingConnects,
          loans,
        })
        callbackOutcome = Promise.allSettled([
          Promise.resolve().then(() => actionScope.run(token, () => action(waitForLock))),
        ])
        const [result] = await callbackOutcome
        if (result?.status === 'rejected') throw result.reason
        if (!result || !witnessed) throw new Error('Owned action omitted its native lock witness')
        return result.value
      } catch (err) {
        primary = { reason: err }
        throw err
      } finally {
        await dispose()
      }
    })
  } catch (err) {
    primary ??= { reason: err }
    throw err
  } finally {
    if (!entered) {
      await dispose()
    }
  }
}
