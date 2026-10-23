import { AsyncResource } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { withPostgresPoolQueryFailureForTest } from './pool-query-failure.mts'
import { tryStartTestCluster, type TestCluster } from './test-cluster.test-helpers.mts'

const started = await tryStartTestCluster()

const MARKER = '/* orders:select */'

function fakeClient(query: (text: string) => Promise<unknown>): pg.PoolClient {
  const client = new EventEmitter() as unknown as pg.PoolClient
  // pg-pool destroys a released errored client, which ends the connection.
  Object.assign(client, { query, release: () => setImmediate(() => client.emit('end')) })
  return client
}

function fakePool(client: pg.PoolClient): pg.Pool {
  const pool = new pg.Pool()
  Object.assign(pool, { connect: async () => client })
  return pool
}

describe.skipIf(!started)('withPostgresPoolQueryFailureForTest (real PostgreSQL)', () => {
  afterAll(() => started?.stop())
  const cluster = () => started as TestCluster

  it('answers the marked pool query with 25P02 and leaves the pool usable', async () => {
    const pool = cluster().createPool()
    const { result, error } = await withPostgresPoolQueryFailureForTest(
      MARKER,
      async () => {
        const outcome = await pool
          .query({ text: `${MARKER} SELECT 1 AS one` })
          .catch((err: unknown) => err)
        return outcome
      },
      { pools: [pool] },
    )
    expect(error).toMatchObject({ code: '25P02' })
    expect(result).toBe(error)
    const query = await pool.query('SELECT 2 AS two')
    expect(query.rows).toEqual([{ two: 2 }])
    expect(Object.getOwnPropertyDescriptor(pool, 'query')).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(pool, 'connect')).toBeUndefined()
  })

  it('ignores unmarked queries and queries for another command', async () => {
    const pool = cluster().createPool()
    const { error } = await withPostgresPoolQueryFailureForTest(
      '/* orders:write */',
      async () => {
        expect((await pool.query({ text: '/* orders:write */ SELECT 1 AS one' })).rows).toEqual([
          { one: 1 },
        ])
        expect((await pool.query({ text: 'SELECT 1 AS one' })).rows).toEqual([{ one: 1 }])
        await pool
          .query({ text: '/* orders:write */ UPDATE pg_class SET relname = relname WHERE false' })
          .catch(() => undefined)
      },
      { pools: [pool], command: 'UPDATE' },
    )
    expect(error).toMatchObject({ code: '25P02' })
  })

  it('fails a query raised outside the operation context when the request is owned', async () => {
    const pool = cluster().createPool()
    const outside = AsyncResource.bind(() =>
      pool.query({ text: `${MARKER} SELECT 1 AS one` }).catch((err: unknown) => err),
    )
    const isOwnedRequest = (id: string) => id === 'req-1'
    const { result } = await withPostgresPoolQueryFailureForTest(MARKER, async () => outside(), {
      pools: [pool],
      requestId: 'req-1',
      isOwnedRequest,
    })
    expect(result).toMatchObject({ code: '25P02' })
  })

  it('does not fail a foreign request outside the operation context', async () => {
    const pool = cluster().createPool()
    const outside = AsyncResource.bind(() => pool.query({ text: `${MARKER} SELECT 1 AS one` }))
    const { error } = await withPostgresPoolQueryFailureForTest(
      MARKER,
      async () => {
        expect((await outside()).rows).toEqual([{ one: 1 }])
        await pool.query({ text: `${MARKER} SELECT 1` }).catch(() => undefined)
      },
      { pools: [pool], requestId: 'mine', isOwnedRequest: () => false },
    )
    expect(error).toMatchObject({ code: '25P02' })
  })

  it('rejects query forms the adapter cannot fault', async () => {
    const pool = cluster().createPool()
    await expect(
      withPostgresPoolQueryFailureForTest(MARKER, async () => pool.query(`${MARKER} SELECT 1`), {
        pools: [pool],
      }),
    ).rejects.toThrow('plain-config Promise pool query')
  })

  it('fails when the operation never reaches the marked statement', async () => {
    const pool = cluster().createPool()
    await expect(
      withPostgresPoolQueryFailureForTest(MARKER, async () => 1, { pools: [pool] }),
    ).rejects.toThrow('did not execute the targeted failed SQL')
  })

  it('serializes scopes and rejects nesting', async () => {
    const pool = cluster().createPool()
    await expect(
      withPostgresPoolQueryFailureForTest(
        MARKER,
        async () => withPostgresPoolQueryFailureForTest(MARKER, async () => 1, { pools: [pool] }),
        { pools: [pool] },
      ),
    ).rejects.toThrow('cannot be nested')
  })
})

describe('withPostgresPoolQueryFailureForTest (validation and fake clients)', () => {
  const pool = new pg.Pool()

  it('validates marker, pools and request ownership', async () => {
    const run = (
      marker: string,
      options: Parameters<typeof withPostgresPoolQueryFailureForTest>[2],
    ) => withPostgresPoolQueryFailureForTest(marker, async () => 1, options)
    await expect(run('SELECT', { pools: [pool] })).rejects.toThrow('leading query annotation')
    await expect(run(MARKER, { pools: [] })).rejects.toThrow('at least one pool')
    await expect(run(MARKER, { pools: [pool], requestId: 'a' })).rejects.toThrow('isOwnedRequest')
    await expect(
      run(MARKER, { pools: [pool], requestId: '', isOwnedRequest: () => true }),
    ).rejects.toThrow('isOwnedRequest')
  })

  async function expectFault(client: pg.PoolClient, message: string): Promise<void> {
    const target = fakePool(client)
    await expect(
      withPostgresPoolQueryFailureForTest(
        MARKER,
        async () => target.query({ text: `${MARKER} SELECT 1` }),
        { pools: [target] },
      ),
    ).rejects.toThrow(message)
  }

  it('rejects a server that accepts the division by zero', async () => {
    await expectFault(
      fakeClient(async () => ({ rows: [] })),
      'unexpectedly accepted',
    )
  })

  it('rethrows an unexpected error from the division by zero', async () => {
    await expectFault(
      fakeClient(async (text) => {
        if (text.includes('SELECT 1 / 0')) throw new Error('connection reset')
        return { rows: [] }
      }),
      'connection reset',
    )
  })

  it('rejects when the pool core never acquires the lease', async () => {
    const target = new pg.Pool()
    const failed = Object.assign(new Error('aborted'), { code: '25P02' })
    const client = fakeClient(async (text) => {
      if (text.includes('SELECT 1 / 0')) throw Object.assign(new Error('div'), { code: '22012' })
      return { rows: [] }
    })
    Object.assign(target, {
      connect: async () => client,
      query: async () => {
        throw failed
      },
    })
    await expect(
      withPostgresPoolQueryFailureForTest(
        MARKER,
        async () => target.query({ text: `${MARKER} SELECT 1` }),
        { pools: [target] },
      ),
    ).rejects.toThrow('did not acquire the lease')
  })

  it('reports a client that does not close in time', async () => {
    const target = new pg.Pool()
    const client = new EventEmitter() as unknown as pg.PoolClient
    Object.assign(client, {
      release: () => undefined,
      query: async (text: string) => {
        if (text.includes('SELECT 1 / 0')) throw Object.assign(new Error('div'), { code: '22012' })
        return { rows: [] }
      },
    })
    Object.assign(target, { connect: async () => client, query: async () => ({ rows: [] }) })
    await expect(
      withPostgresPoolQueryFailureForTest(
        MARKER,
        async () => target.query({ text: `${MARKER} SELECT 1` }),
        { pools: [target], endTimeoutMs: 10 },
      ),
    ).rejects.toThrow('did not finish closing')
  })

  it('rejects a pool core that answers the aborted client successfully', async () => {
    const target = new pg.Pool()
    const client = fakeClient(async (text) => {
      if (text.includes('SELECT 1 / 0')) throw Object.assign(new Error('div'), { code: '22012' })
      return { rows: [] }
    })
    Object.assign(target, { connect: async () => client, query: async () => ({ rows: [] }) })
    await expect(
      withPostgresPoolQueryFailureForTest(
        MARKER,
        async () => target.query({ text: `${MARKER} SELECT 1` }),
        { pools: [target] },
      ),
    ).rejects.toThrow('did not execute the targeted failed SQL')
  })

  it('rethrows non-25P02 errors and wraps non-Error rejections', async () => {
    for (const [thrown, expected] of [
      [new Error('boom'), 'boom'],
      ['plain string', 'non-Error rejection'],
    ] as const) {
      const target = new pg.Pool()
      const client = fakeClient(async (text) => {
        if (text.includes('SELECT 1 / 0')) throw Object.assign(new Error('div'), { code: '22012' })
        return { rows: [] }
      })
      Object.assign(target, {
        connect: async () => client,
        query: async () => {
          throw thrown
        },
      })
      await expect(
        withPostgresPoolQueryFailureForTest(
          MARKER,
          async () => target.query({ text: `${MARKER} SELECT 1` }),
          { pools: [target] },
        ),
      ).rejects.toThrow(expected)
    }
  })
})
