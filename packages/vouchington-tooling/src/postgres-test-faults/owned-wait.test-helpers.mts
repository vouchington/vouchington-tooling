import type pg from 'pg'
import type { TestOwnedPostgresWaitOptions } from './lock-identity.mts'
import type { TestCluster } from './test-cluster.test-helpers.mts'

/** Real PostgreSQL does not enforce a version here; the notice text is stable across majors. */
const ANY_VERSION = { min: 0, max: Number.MAX_SAFE_INTEGER }

export const ADVISORY_SQL = "SELECT pg_advisory_lock(hashtextextended('owned-wait', 0))"
/** Waiters take transaction-scoped locks so a pooled backend never keeps one after the test. */
export const WAITER_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('owned-wait', 0))"

/** A holder connection that takes a lock and can later release it. */
export type Holder = {
  client: pg.PoolClient
  processId: number
  release: () => Promise<void>
}

export async function createFixture(cluster: TestCluster) {
  const pool = cluster.createPool(8)
  const observerPool = cluster.createPool(4)
  const holders: pg.PoolClient[] = []
  await pool.query(`CREATE TABLE IF NOT EXISTS owned_wait_rows (id int PRIMARY KEY, v int)`)
  await pool.query(`INSERT INTO owned_wait_rows VALUES (1, 0) ON CONFLICT DO NOTHING`)

  async function holder(setup: string[]): Promise<Holder> {
    const client = await observerPool.connect()
    holders.push(client)
    for (const sql of setup) await client.query(sql)
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    let released: Promise<void> | undefined
    return {
      client,
      processId: rows[0]!.pid,
      release: () =>
        (released ??= (async () => {
          await client.query('COMMIT').catch(() => undefined)
          await client.query('SELECT pg_advisory_unlock_all()')
        })()),
    }
  }

  function options(
    held: Holder,
    overrides: Partial<TestOwnedPostgresWaitOptions> & Pick<TestOwnedPostgresWaitOptions, 'lock'>,
  ): TestOwnedPostgresWaitOptions {
    return {
      pool,
      observerPool: cluster.createPool(2),
      holderProcessId: held.processId,
      queryMarker: '/* owned-waiter */',
      releaseHolder: held.release,
      notice: { serverVersionNum: ANY_VERSION, applicationNamePrefix: 'owned-wait-test' },
      ...overrides,
    }
  }

  return {
    pool,
    holder,
    options,
    async cleanup() {
      for (const client of holders.splice(0)) {
        await client.query('ROLLBACK').catch(() => undefined)
        await client.query('SELECT pg_advisory_unlock_all()').catch(() => undefined)
        client.release()
      }
    },
  }
}
