import pg from 'pg'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createPostgresLockObservers, type QueryExecutor } from './index.mts'
import { tryStartTestCluster, type TestCluster } from './test-cluster.test-helpers.mts'

const started = await tryStartTestCluster()

const toExecutor = (target: pg.Pool | pg.PoolClient): QueryExecutor =>
  ((query) => target.query(query)) as QueryExecutor

describe.skipIf(!started)('lock observers (real PostgreSQL)', () => {
  afterAll(() => started?.stop())
  const cluster = () => started as TestCluster
  const clients: pg.PoolClient[] = []
  const pending: Promise<unknown>[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.query('SELECT pg_advisory_unlock_all()').catch(() => undefined)
      client.release()
    }
    await Promise.allSettled(pending.splice(0))
  })

  async function setup(overrides: { timeoutMs?: number } = {}) {
    const pool = cluster().createPool(8)
    const observers = createPostgresLockObservers({
      write: toExecutor(pool),
      advisoryLockPool: toExecutor(cluster().createPool(2)),
      intervalMs: 5,
      ...overrides,
    })
    const lease = async () => {
      const client = await pool.connect()
      clients.push(client)
      return client
    }
    return { pool, observers, lease }
  }

  it('reports the backend process id of a connection', async () => {
    const { pool, observers } = await setup()
    const client = await pool.connect()
    try {
      const reported = await observers.getTestPostgresBackendProcessId(toExecutor(client))
      const { rows } = await client.query('SELECT pg_backend_pid() AS pid')
      expect(reported).toBe(rows[0].pid)
    } finally {
      client.release()
    }
  })

  it('finds advisory-lock holders for single-key, namespaced and shared locks', async () => {
    const { observers, lease } = await setup()
    const holder = await lease()
    const pid = await observers.getTestPostgresBackendProcessId(toExecutor(holder))
    await holder.query("SELECT pg_advisory_lock(hashtextextended('one', 0))")
    await holder.query("SELECT pg_advisory_lock(7, hashtext('two'))")
    await holder.query("SELECT pg_advisory_lock_shared(7, hashtext('shared'))")
    expect(await observers.getTestPostgresAdvisoryLockHolderProcessId({ key: 'one' })).toBe(pid)
    expect(
      await observers.getTestPostgresAdvisoryLockHolderProcessId({ key: 'two', namespace: 7 }),
    ).toBe(pid)
    expect(
      await observers.getTestPostgresAdvisoryLockHolderProcessId({
        key: 'shared',
        namespace: 7,
        mode: 'shared',
      }),
    ).toBe(pid)
    await expect(
      observers.getTestPostgresAdvisoryLockHolderProcessId({ key: 'absent' }),
    ).rejects.toThrow('did not report the test advisory-lock holder')
  })

  it('waits for a blocked waiter through every observer kind', async () => {
    const { observers, lease } = await setup()
    const holder = await lease()
    const waiter = await lease()
    const observer = await lease()
    const holderPid = await observers.getTestPostgresBackendProcessId(toExecutor(holder))
    const waiterPid = await observers.getTestPostgresBackendProcessId(toExecutor(waiter))
    await holder.query("SELECT pg_advisory_lock(hashtextextended('wait', 0))")
    pending.push(
      waiter.query("/* blocked-op */ SELECT pg_advisory_lock(hashtextextended('wait', 0))"),
    )
    const diagnostics: string[] = []
    await observers.waitForTestPostgresLockWaiter(holderPid, 'blocked-op')
    await observers.waitForTestPostgresLockWaiter(holderPid, 'blocked-op', 'advisoryLock')
    await observers.waitForTestPostgresLockWaiter(
      holderPid,
      'blocked-op',
      toExecutor(observer),
      (diagnostic) => diagnostics.push(diagnostic.phase),
      new AbortController().signal,
      waiterPid,
    )
    expect(diagnostics).toEqual([
      'snapshot-clear-start',
      'snapshot-cleared',
      'waiter-query-start',
      'waiter-query',
    ])
    await holder.query('SELECT pg_advisory_unlock_all()')
  })

  it('matches markers literally instead of as LIKE wildcards', async () => {
    const { observers, lease } = await setup({ timeoutMs: 100 })
    const holder = await lease()
    const waiter = await lease()
    const holderPid = await observers.getTestPostgresBackendProcessId(toExecutor(holder))
    await holder.query("SELECT pg_advisory_lock(hashtextextended('literal', 0))")
    pending.push(
      waiter.query("/* blocked_op */ SELECT pg_advisory_lock(hashtextextended('literal', 0))"),
    )
    await observers.waitForTestPostgresLockWaiter(holderPid, 'blocked_op')
    await expect(observers.waitForTestPostgresLockWaiter(holderPid, 'blocked%op')).rejects.toThrow(
      'did not wait for the test lock',
    )
    await expect(observers.waitForTestPostgresLockWaiter(holderPid, 'blockedXop')).rejects.toThrow(
      'did not wait for the test lock',
    )
    await holder.query('SELECT pg_advisory_unlock_all()')
  })

  it('times out with the marker when nothing is blocked', async () => {
    const { observers, lease } = await setup({ timeoutMs: 50 })
    const holder = await lease()
    const holderPid = await observers.getTestPostgresBackendProcessId(toExecutor(holder))
    const error = await observers
      .waitForTestPostgresLockWaiter(holderPid, 'never-blocked')
      .catch((err: unknown) => err as Error)
    expect(error).toMatchObject({
      message: 'Operation did not wait for the test lock: never-blocked',
    })
    expect((error as Error).cause).toMatchObject({ message: expect.stringContaining('Timed out') })
  })

  it('stops when the signal aborts and keeps the abort reason', async () => {
    const { observers, lease } = await setup()
    const holder = await lease()
    const holderPid = await observers.getTestPostgresBackendProcessId(toExecutor(holder))
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    const error = await observers
      .waitForTestPostgresLockWaiter(holderPid, 'x', 'write', undefined, controller.signal)
      .catch((err: unknown) => err as Error)
    expect((error as Error).cause).toMatchObject({ message: 'cancelled' })
  })

  it('wraps a failure that races with cancellation', async () => {
    const controller = new AbortController()
    const observers = createPostgresLockObservers({
      write: async () => {
        controller.abort(new Error('cancelled'))
        throw new Error('query failed')
      },
    })
    const error = await observers
      .waitForTestPostgresLockWaiter(1, 'x', 'write', undefined, controller.signal)
      .catch((err: unknown) => err as Error)
    expect((error as Error).cause).toBeInstanceOf(SuppressedError)
  })

  it('requires an advisory-lock executor for the advisoryLock observer', async () => {
    const observers = createPostgresLockObservers({
      write: async () => ({ rows: [] }),
      timeoutMs: 20,
    })
    const error = await observers
      .waitForTestPostgresLockWaiter(1, 'x', 'advisoryLock')
      .catch((err: unknown) => err as Error)
    expect(((error as Error).cause as Error).message).toContain('requires an advisoryLockPool')
  })

  it('observes a transitive lock chain', async () => {
    const { observers, lease } = await setup()
    const holder = await lease()
    const direct = await lease()
    const indirect = await lease()
    const observer = await lease()
    await holder.query('CREATE TABLE IF NOT EXISTS lock_chain (id integer PRIMARY KEY, v integer)')
    await holder.query('INSERT INTO lock_chain VALUES (1, 0) ON CONFLICT DO NOTHING')
    const holderPid = await observers.getTestPostgresBackendProcessId(toExecutor(holder))
    await holder.query("SELECT pg_advisory_lock(hashtextextended('chain', 0))")
    await direct.query('BEGIN')
    await direct.query('UPDATE lock_chain SET v = 1 WHERE id = 1')
    pending.push(
      direct.query("/* direct-op */ SELECT pg_advisory_lock(hashtextextended('chain', 0))"),
    )
    pending.push(indirect.query('/* indirect-op */ UPDATE lock_chain SET v = 2 WHERE id = 1'))
    await observers.waitForTestPostgresBlockedLockChain(holderPid, 'direct-op', ['indirect-op'])
    await observers.waitForTestPostgresBlockedLockChain(
      holderPid,
      'direct-op',
      ['indirect-op'],
      'write',
    )
    await observers.waitForTestPostgresBlockedLockChain(
      holderPid,
      'direct-op',
      ['indirect-op'],
      toExecutor(observer),
    )
    await holder.query('SELECT pg_advisory_unlock_all()')
  })

  it('times out when no chain forms', async () => {
    const { observers } = await setup({ timeoutMs: 50 })
    await expect(
      observers.waitForTestPostgresBlockedLockChain(1, 'direct-op', ['indirect-op']),
    ).rejects.toThrow('did not form a lock chain')
  })
})

describe('lock observers (fake executors)', () => {
  it('times out on empty observations with the default interval', async () => {
    const observers = createPostgresLockObservers({
      write: async () => ({ rows: [] }),
      timeoutMs: 30,
    })
    const diagnostics: boolean[] = []
    await expect(
      observers.waitForTestPostgresLockWaiter(1, 'x', 'write', (diagnostic) =>
        diagnostics.push(diagnostic.waiting),
      ),
    ).rejects.toThrow('did not wait for the test lock')
    expect(diagnostics).toContain(false)
    await expect(
      observers.waitForTestPostgresBlockedLockChain(1, 'a', ['b'], 'write'),
    ).rejects.toThrow('did not form a lock chain')
  })

  it('rejects a backend id query that returns no row', async () => {
    const observers = createPostgresLockObservers({ write: async () => ({ rows: [] }) })
    await expect(
      observers.getTestPostgresBackendProcessId(async () => ({ rows: [] })),
    ).rejects.toThrow('did not return a backend process ID')
  })
})
