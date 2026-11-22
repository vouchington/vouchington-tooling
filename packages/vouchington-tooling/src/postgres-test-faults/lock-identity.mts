import type pg from 'pg'
import type { LockNoticeOptions } from './lock-notice.mts'

export type TestPostgresLockIdentity = {
  holderProcessId: number
  lock:
    | {
        kind: 'advisory'
        key: string
        namespace?: number
        holderMode?: 'exclusive' | 'shared'
        waiterMode?: 'exclusive' | 'shared'
      }
    | {
        kind: 'advisory32'
        key: string
        holderMode?: 'exclusive' | 'shared'
        waiterMode?: 'exclusive' | 'shared'
      }
    | {
        kind: 'relation'
        name: string
        waiterMode: 'AccessShareLock' | 'RowExclusiveLock'
      }
    | { kind: 'transaction' }
}
export type TestHeldPostgresLock =
  | { kind: 'advisory'; tag: string; waiterMode: 'exclusive' | 'shared' }
  | { kind: 'relation'; tag: string; waiterMode: 'AccessShareLock' | 'RowExclusiveLock' }
  | { kind: 'transaction'; transactionId: string }
export type TestOwnedPostgresWaitOptions = TestPostgresLockIdentity & {
  /** The pool whose checkout becomes the lock waiter. */
  pool: pg.Pool
  /** A different pool that supplies the observer connection, so the observer never contends. */
  observerPool: pg.Pool
  /** Exact leading query annotation (a block comment) of the statement that must wait. */
  queryMarker: string
  /** Own the waiter by request id when it checks out outside the action's async context. */
  requestId?: string
  /** Decides whether the current execution context belongs to `requestId`. Required with it. */
  isOwnedRequest?: (requestId: string) => boolean
  releaseHolder: () => PromiseLike<void>
  /** Session settings and prerequisites of the native notice observation. */
  notice?: LockNoticeOptions
}

type Lock = TestPostgresLockIdentity['lock']
type AdvisoryLock = Extract<Lock, { kind: 'advisory' | 'advisory32' }>

/** Proves the owned holder reports exactly the identified lock, and returns its notice identity. */
export async function getTestOwnedPostgresLock(
  observer: pg.PoolClient,
  identity: TestPostgresLockIdentity,
): Promise<TestHeldPostgresLock> {
  if (identity.lock.kind === 'relation') {
    const { rows } = await observer.query<{ lock_tag: string }>(
      `/* getTestOwnedRelationLockTag */
      SELECT 'relation ' || relation::text || ' of database ' || database::text AS lock_tag
      FROM pg_locks
      WHERE pid = $1 AND locktype = 'relation' AND granted
        AND mode = 'AccessExclusiveLock'
        AND relation = to_regclass($2)
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      LIMIT 2`,
      [identity.holderProcessId, identity.lock.name],
    )
    if (rows.length !== 1 || !rows[0])
      throw new Error('Owned holder did not report exactly the expected relation lock')
    return { kind: 'relation', tag: rows[0].lock_tag, waiterMode: identity.lock.waiterMode }
  }
  if (identity.lock.kind !== 'transaction')
    return {
      kind: 'advisory',
      tag: await getTestOwnedAdvisoryLockTag(observer, identity.holderProcessId, identity.lock),
      waiterMode: identity.lock.waiterMode ?? 'exclusive',
    }
  const { rows } = await observer.query<{ transaction_id: string }>(
    `/* getTestOwnedTransactionLock */
      SELECT locks.transactionid::text AS transaction_id
      FROM pg_locks locks JOIN pg_stat_activity activity ON activity.pid = locks.pid
      WHERE locks.pid = $1 AND activity.datname = current_database()
        AND locks.locktype = 'transactionid' AND locks.mode = 'ExclusiveLock' AND locks.granted
      LIMIT 2`,
    [identity.holderProcessId],
  )
  if (rows.length !== 1 || !rows[0])
    throw new Error('Owned holder did not report exactly one granted transaction identity')
  return { kind: 'transaction', transactionId: rows[0].transaction_id }
}

async function getTestOwnedAdvisoryLockTag(
  observer: pg.PoolClient,
  holderProcessId: number,
  lock: AdvisoryLock,
): Promise<string> {
  const { rows } = await observer.query<{ lock_tag: string }>(
    `/* getTestOwnedAdvisoryLockTag */
      SELECT 'advisory lock [' || database::text || ',' || classid::text || ',' ||
        objid::text || ',' || objsubid::text || ']' AS lock_tag
      FROM pg_locks
      WHERE pid = $1 AND locktype = 'advisory' AND granted
        AND mode = CASE WHEN $5::text = 'shared' THEN 'ShareLock' ELSE 'ExclusiveLock' END
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND (($3::integer IS NULL AND objsubid = 1
          AND classid::bigint = (((CASE WHEN $4::boolean THEN hashtext($2)::bigint
            ELSE hashtextextended($2, 0) END) >> 32) & 4294967295)
          AND objid::bigint = ((CASE WHEN $4::boolean THEN hashtext($2)::bigint
            ELSE hashtextextended($2, 0) END) & 4294967295))
        OR ($3::integer IS NOT NULL AND objsubid = 2
          AND classid::bigint = ($3::bigint & 4294967295)
          AND objid::bigint = (hashtext($2)::bigint & 4294967295)))
      LIMIT 2`,
    [
      holderProcessId,
      lock.key,
      'namespace' in lock ? (lock.namespace ?? null) : null,
      lock.kind === 'advisory32',
      lock.holderMode ?? 'exclusive',
    ],
  )
  if (rows.length !== 1 || !rows[0])
    throw new Error('Owned holder did not report exactly the expected advisory lock')
  return rows[0].lock_tag
}

/** One ownership snapshot, admitted only after the exact native lock-wait notice. */
export async function assertTestOwnedPostgresWait(
  observer: pg.PoolClient,
  waiterProcessId: number,
  holderProcessId: number,
  queryMarker: string,
): Promise<void> {
  const { rows } = await observer.query<{
    database_matches: boolean
    state: string | null
    wait_event_type: string | null
    wait_event: string | null
    query_matches: boolean
    lock_queued: boolean
    blocking_process_ids: number[]
  }>(
    `/* assertTestOwnedPostgresWait */
      SELECT datname = current_database() AS database_matches,
        state, wait_event_type, wait_event,
        position($2 IN query) > 0 AS query_matches,
        EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted) AS lock_queued,
        pg_blocking_pids(pid) AS blocking_process_ids
      FROM pg_stat_activity WHERE pid = $1`,
    [waiterProcessId, queryMarker],
  )
  const observed = rows[0]
  // ProcSleep emits the native notice between WaitLatch calls. Its wait-event telemetry can
  // be empty while the lock request is still queued; pg_locks and pg_blocking_pids prove that wait.
  if (
    !observed?.database_matches ||
    observed.state !== 'active' ||
    !observed.query_matches ||
    !observed.lock_queued ||
    !observed.blocking_process_ids.includes(holderProcessId)
  )
    throw new Error('Native lock notice did not match the owned holder and real query', {
      cause: {
        expected: { waiterProcessId, holderProcessId, queryMarker },
        observed: observed ?? null,
      },
    })
}
