import type pg from 'pg'

export type TestPostgresAdvisoryLock = {
  release(): Promise<void>
}

export interface AcquireTestPostgresAdvisoryLockOptions {
  namespace: number
  key: number
  timeout: string
  mode?: 'shared' | 'exclusive'
}

/**
 * Acquires a session-level PostgreSQL advisory lock on a leased `pg.PoolClient` under a
 * transaction-local `statement_timeout`, returning an idempotent `release()` handle whose
 * concurrent callers await the same single-shot unlock.
 */
export async function acquireTestPostgresAdvisoryLock(
  pool: pg.Pool,
  options: AcquireTestPostgresAdvisoryLockOptions,
): Promise<TestPostgresAdvisoryLock> {
  const { namespace, key, timeout, mode = 'exclusive' } = options
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['statement_timeout', timeout])
    await client.query(
      mode === 'shared'
        ? '/* acquireTestPostgresAdvisoryLock */ SELECT pg_advisory_lock_shared($1, $2)'
        : '/* acquireTestPostgresAdvisoryLock */ SELECT pg_advisory_lock($1, $2)',
      [namespace, key],
    )
    await client.query('COMMIT')
  } catch (err) {
    client.release(toError(err))
    throw err
  }

  return createTestPostgresAdvisoryLock(client, namespace, key, mode)
}

function createTestPostgresAdvisoryLock(
  client: pg.PoolClient,
  namespace: number,
  key: number,
  mode: 'shared' | 'exclusive',
): TestPostgresAdvisoryLock {
  let releasePromise: Promise<void> | undefined

  return {
    release(): Promise<void> {
      releasePromise ??= (async () => {
        try {
          const result = await client.query<{ unlocked: boolean }>(
            mode === 'shared'
              ? '/* releaseTestPostgresAdvisoryLock */ SELECT pg_advisory_unlock_shared($1, $2) AS unlocked'
              : '/* releaseTestPostgresAdvisoryLock */ SELECT pg_advisory_unlock($1, $2) AS unlocked',
            [namespace, key],
          )
          if (!result.rows[0]?.unlocked) {
            throw new Error('PostgreSQL did not release the test advisory lock')
          }
          client.release()
        } catch (err) {
          client.release(toError(err))
          throw err
        }
      })()
      return releasePromise
    },
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
