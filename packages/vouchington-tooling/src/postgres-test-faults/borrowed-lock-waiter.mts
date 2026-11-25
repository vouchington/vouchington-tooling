import type pg from 'pg'
import { onTestFinished } from 'vitest'
import {
  observeTestAdvisoryLockNotice,
  observeTestTransactionLockNotice,
  type LockNoticeOptions,
} from './lock-notice.mts'
import {
  observeTestPostgresLockQuery,
  type TestPostgresLockQuery,
} from './lock-query-observation.mts'

export type TestLockWaiterHeldLock =
  | { kind: 'transaction' }
  | { kind: 'advisory32' | 'advisory64'; key: string }

export type TestLockWaiterHolder = {
  query: <Row extends object = Record<string, unknown>>(query: {
    text: string
    values?: unknown[]
  }) => Promise<{ rows: Row[] }>
  release: () => Promise<void>
}

export interface CreateTestPostgresLockWaiterOptions<Tx extends AsyncDisposable> {
  pool: pg.Pool
  holder: TestLockWaiterHolder
  beginTransaction: (client: pg.PoolClient) => Promise<Tx>
  lock: TestLockWaiterHeldLock
  selected: TestPostgresLockQuery
  notice?: LockNoticeOptions
  /** Cleanup hook registrar. Defaults to Vitest's `onTestFinished`. */
  registerCleanup?: (cleanup: () => Promise<void> | undefined) => void
}

type Observer = ReturnType<typeof observeTestTransactionLockNotice>

/** Own the holder's failure release and one real borrowed contender transaction. */
export async function createTestPostgresLockWaiter<Tx extends AsyncDisposable>(
  options: CreateTestPostgresLockWaiterOptions<Tx>,
) {
  let closed = false
  let cleanupReported = false
  let cleanupPromise: Promise<void> | undefined
  let reservation: Promise<pg.PoolClient> | undefined
  let setup: Promise<void> | undefined
  let client: pg.PoolClient | undefined
  let transaction: Tx | undefined
  let observer: Observer | undefined
  let observation: ReturnType<typeof observeTestPostgresLockQuery> | undefined
  let actionOutcome: Promise<[PromiseSettledResult<unknown>]> | undefined
  let primaryFailure: { reason: unknown } | undefined
  const ended = Promise.withResolvers<void>()
  const onEnd = () => ended.resolve()
  const requireOpen = () => {
    if (closed) throw new Error('Owned PostgreSQL waiter is already closed')
  }
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      closed = true
      const failures: unknown[] = []
      let holderReleaseFailed = false
      try {
        await options.holder.release()
      } catch (err) {
        holderReleaseFailed = true
        failures.push(err)
      }
      await reservation?.catch(() => undefined)
      await setup?.catch(() => undefined)
      // If releasing the holder failed, the contender may stay blocked; discard without hanging on actionOutcome.
      const settled = holderReleaseFailed ? undefined : await actionOutcome
      const hadUndrainedQueries = (observation?.pendingQueries ?? 0) !== 0
      observation?.restore()
      if (!holderReleaseFailed) {
        try {
          await transaction?.[Symbol.asyncDispose]()
        } catch (err) {
          failures.push(err)
        }
        try {
          await observer?.close()
        } catch (err) {
          failures.push(err)
        }
      }
      if (hadUndrainedQueries) {
        failures.push(new Error('Owned lock queries did not finish draining'))
      }
      if (failures.length && primaryFailure) failures.unshift(primaryFailure.reason)
      else if (failures.length && settled?.[0].status === 'rejected') {
        failures.unshift(settled[0].reason)
      }
      const failure = failures.length
        ? new AggregateError(failures, 'Owned PostgreSQL waiter cleanup failed')
        : undefined
      if (client) {
        const discard = failure ?? (primaryFailure !== undefined ? true : undefined)
        client.release(discard)
        if (discard) await ended.promise
        client.off('end', onEnd)
      }
      if (failure) throw failure
    })())
  const dispose = async () => {
    try {
      await cleanup()
    } finally {
      cleanupReported = true
    }
  }
  const registerCleanup = options.registerCleanup ?? onTestFinished
  try {
    registerCleanup(() => (cleanupReported ? undefined : dispose()))
    setup = (async () => {
      const lock = await readHeldLock(options.holder, options.lock)
      requireOpen()
      reservation = options.pool.connect()
      client = await reservation
      client.once('end', onEnd)
      requireOpen()
      const callerEligible = options.notice?.eligible
      const eligible = () =>
        observation?.selectedPending === true && (callerEligible ? callerEligible() : true)
      observer =
        lock.kind === 'advisory'
          ? observeTestAdvisoryLockNotice(client, lock.tag, { ...options.notice, eligible })
          : observeTestTransactionLockNotice(client, lock.transactionId, {
              ...options.notice,
              eligible,
            })
      await observer.ready
      requireOpen()
      transaction = await options.beginTransaction(client)
      requireOpen()
      observation = observeTestPostgresLockQuery(client, options.selected)
    })()
    await setup
    return {
      query: transaction!,
      waitForLock(action: Promise<unknown>): Promise<void> {
        if (closed || actionOutcome) {
          throw new Error('Owned PostgreSQL waiter accepts one live action')
        }
        actionOutcome = Promise.allSettled([action] as const)
        return observer!.wait(actionOutcome)
      },
      [Symbol.asyncDispose]: dispose,
    }
  } catch (err) {
    primaryFailure = { reason: err }
    await dispose()
    throw err
  }
}

async function readHeldLock(holder: TestLockWaiterHolder, lock: TestLockWaiterHeldLock) {
  if (lock.kind === 'transaction') {
    const { rows } = await holder.query<{ transaction_id: string }>({
      text: `
      /* createTestPostgresLockWaiter.transaction */
      SELECT pg_current_xact_id()::text AS transaction_id
    `,
    })
    const transactionId = rows[0]?.transaction_id
    if (!transactionId) throw new Error('Owned holder has no PostgreSQL transaction ID')
    return { kind: 'transaction' as const, transactionId }
  }
  const hashSql = lock.kind === 'advisory32' ? 'hashtext($1)::bigint' : 'hashtextextended($1, 0)'
  const { rows } = await holder.query<{ lock_tag: string }>({
    text: `
    /* createTestPostgresLockWaiter.advisory */
    SELECT 'advisory lock [' || database::text || ',' || classid::text || ',' ||
      objid::text || ',' || objsubid::text || ']' AS lock_tag
    FROM pg_locks
    WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted AND mode = 'ExclusiveLock'
      AND objsubid = 1
      AND classid::bigint = ((${hashSql} >> 32) & 4294967295)
      AND objid::bigint = (${hashSql} & 4294967295)
    LIMIT 2
  `,
    values: [lock.key],
  })
  const tag = rows[0]?.lock_tag
  if (!tag || rows.length !== 1) {
    throw new Error('Owned holder does not have the exact advisory lock')
  }
  return { kind: 'advisory' as const, tag }
}
