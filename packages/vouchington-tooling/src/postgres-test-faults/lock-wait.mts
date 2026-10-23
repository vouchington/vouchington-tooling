import type { LockObserverConfig, ObserverPool, QueryExecutor } from './fault-types.mts'

/** Returns the PostgreSQL backend PID serving `query`'s current connection. */
export async function getTestPostgresBackendProcessId(query: QueryExecutor): Promise<number> {
  const { rows } = await query<{ process_id: number }>({
    text: `
    /* getTestPostgresBackendProcessId */
    SELECT pg_backend_pid()::integer AS process_id
  `,
  })
  const processId = rows[0]?.process_id
  if (processId === undefined) throw new Error('PostgreSQL did not return a backend process ID')
  return processId
}

/** Runs `text` on the executor chosen by `observerPool`. */
export function runObservation<Row extends object>(
  config: LockObserverConfig,
  observerPool: ObserverPool,
  text: string,
  values: unknown[],
): Promise<{ rows: Row[] }> {
  if (typeof observerPool === 'function') return observerPool<Row>({ text, values })
  if (observerPool === 'write') return config.write<Row>({ text, values })
  if (!config.advisoryLockPool)
    throw new Error("The 'advisoryLock' observer requires an advisoryLockPool executor")
  return config.advisoryLockPool<Row>({ text, values })
}

/** Returns the backend PID holding an exact session advisory lock owned by this test. */
export async function getAdvisoryLockHolderProcessId(
  config: LockObserverConfig,
  input: { key: string; mode?: 'exclusive' | 'shared'; namespace?: number },
): Promise<number> {
  const lockMode = input.mode === 'shared' ? 'ShareLock' : 'ExclusiveLock'
  const result =
    input.namespace === undefined
      ? await config.write<{ process_id: number }>({
          text: `
          /* getTestPostgresAdvisoryLockHolderProcessId:oneInt */
          SELECT pid::integer AS process_id
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND mode = $1
            AND granted
            AND objsubid = 1
            AND classid::bigint = ((hashtextextended($2::text, 0) >> 32) & 4294967295)
            AND objid::bigint = (hashtextextended($2::text, 0) & 4294967295)
        `,
          values: [lockMode, input.key],
        })
      : await config.write<{ process_id: number }>({
          text: `
          /* getTestPostgresAdvisoryLockHolderProcessId:twoInt */
          SELECT pid::integer AS process_id
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND mode = $1
            AND granted
            AND objsubid = 2
            AND classid = $2::integer::oid
            AND objid = hashtext($3::text)::oid
        `,
          values: [lockMode, input.namespace, input.key],
        })
  const processId = result.rows[0]?.process_id
  if (processId === undefined)
    throw new Error('PostgreSQL did not report the test advisory-lock holder')
  return processId
}
