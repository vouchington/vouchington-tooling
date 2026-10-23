import { AsyncResource } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { withPostgresQueryFailureForTest } from './query-failure.mts'
import { tryStartTestCluster, type TestCluster } from './test-cluster.test-helpers.mts'

const started = await tryStartTestCluster()

const MARKER = '/* orders:insert */'

async function inTransaction(pool: pg.Pool, text: string): Promise<unknown> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    return await client.query({ text }).catch((err: unknown) => err)
  } finally {
    await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}

function fakePool(query: (text: string) => Promise<unknown>): pg.Pool {
  const pool = new pg.Pool()
  const client = new EventEmitter() as unknown as pg.PoolClient
  Object.assign(client, {
    query: (input: string | { text: string }) =>
      query(typeof input === 'string' ? input : input.text),
    release: () => undefined,
  })
  Object.assign(pool, { connect: async () => client })
  return pool
}

describe.skipIf(!started)('withPostgresQueryFailureForTest (real PostgreSQL)', () => {
  afterAll(() => started?.stop())
  const cluster = () => started as TestCluster

  it('fails the marked statement inside an owned transaction with 25P02', async () => {
    const pool = cluster().createPool()
    const { result, error } = await withPostgresQueryFailureForTest(
      MARKER,
      () => inTransaction(pool, `${MARKER} SELECT 1 AS one`),
      { pools: [pool] },
    )
    expect(error).toMatchObject({ code: '25P02' })
    expect(result).toBe(error)
    expect((await pool.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }])
  })

  it('restores pool and client methods and passes other statements through', async () => {
    const pool = cluster().createPool()
    await withPostgresQueryFailureForTest(
      MARKER,
      async () => {
        const client = await pool.connect()
        expect(Object.getOwnPropertyDescriptor(client, 'query')).toBeDefined()
        await client.query('BEGIN')
        expect((await client.query({ text: '/* other */ SELECT 1 AS one' })).rows).toEqual([
          { one: 1 },
        ])
        await client.query('COMMIT')
        await client.query('begin')
        await client.query({ text: `${MARKER} SELECT 1` }).catch(() => undefined)
        await client.query('ROLLBACK')
        client.release()
        expect(Object.getOwnPropertyDescriptor(client, 'query')).toBeUndefined()
      },
      { pools: [pool] },
    )
    expect(Object.getOwnPropertyDescriptor(pool, 'connect')).toBeUndefined()
  })

  it('keeps the transaction open across ROLLBACK TO SAVEPOINT', async () => {
    const pool = cluster().createPool()
    const { result } = await withPostgresQueryFailureForTest(
      MARKER,
      async () => {
        const client = await pool.connect()
        await client.query('BEGIN')
        await client.query('SAVEPOINT s')
        await client.query('ROLLBACK TO SAVEPOINT s')
        await client.query('COMMIT AND CHAIN')
        const outcome = await client
          .query({ text: `${MARKER} SELECT 1` })
          .catch((err: unknown) => err)
        await client.query('ROLLBACK')
        client.release()
        return outcome
      },
      { pools: [pool] },
    )
    expect(result).toMatchObject({ code: '25P02' })
  })

  it('only targets the configured command', async () => {
    const pool = cluster().createPool()
    const { error } = await withPostgresQueryFailureForTest(
      MARKER,
      async () => {
        const client = await pool.connect()
        await client.query('BEGIN')
        await client.query({ text: `${MARKER} SELECT 1` })
        await client
          .query({ text: `${MARKER}\n INSERT INTO pg_temp.nope VALUES (1)` })
          .catch(() => undefined)
        await client.query('ROLLBACK')
        client.release()
      },
      { pools: [pool], command: 'INSERT' },
    )
    expect(error).toMatchObject({ code: '25P02' })
  })

  it('fails a transaction owned by the request outside the operation context', async () => {
    const pool = cluster().createPool()
    const outside = AsyncResource.bind(async () => {
      const client = await pool.connect()
      await client.query('BEGIN')
      const outcome = await client
        .query({ text: `${MARKER} SELECT 1` })
        .catch((err: unknown) => err)
      await client.query('ROLLBACK')
      client.release()
      return outcome
    })
    const { result } = await withPostgresQueryFailureForTest(MARKER, async () => outside(), {
      pools: [pool],
      requestId: 'req-1',
      isOwnedRequest: (id) => id === 'req-1',
    })
    expect(result).toMatchObject({ code: '25P02' })
  })

  it('leaves pool.query callers and foreign requests untouched', async () => {
    const pool = cluster().createPool()
    const outside = AsyncResource.bind(() => pool.query('SELECT 1 AS one'))
    await withPostgresQueryFailureForTest(
      MARKER,
      async () => {
        expect((await pool.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }])
        expect((await outside()).rows).toEqual([{ one: 1 }])
        await inTransaction(pool, `${MARKER} SELECT 1`)
      },
      { pools: [pool], requestId: 'mine', isOwnedRequest: () => false },
    )
  })

  it('rejects a marked statement outside a transaction or in an unsupported form', async () => {
    const pool = cluster().createPool()
    await expect(
      withPostgresQueryFailureForTest(
        MARKER,
        async () => {
          const client = await pool.connect()
          try {
            await client.query({ text: `${MARKER} SELECT 1` })
          } finally {
            client.release()
          }
        },
        { pools: [pool] },
      ),
    ).rejects.toThrow('owned transaction adapter Promise query')
    await expect(
      withPostgresQueryFailureForTest(
        MARKER,
        async () => {
          const client = await pool.connect()
          try {
            await client.query('BEGIN')
            await client.query(`${MARKER} SELECT 1`)
          } finally {
            await client.query('ROLLBACK')
            client.release()
          }
        },
        { pools: [pool] },
      ),
    ).rejects.toThrow('owned transaction adapter Promise query')
  })

  it('fails when the targeted statement never runs', async () => {
    const pool = cluster().createPool()
    await expect(
      withPostgresQueryFailureForTest(MARKER, async () => 1, { pools: [pool] }),
    ).rejects.toThrow('did not execute the targeted failed SQL')
  })
})

describe('withPostgresQueryFailureForTest (validation and fake clients)', () => {
  it('validates marker, pools and request ownership', async () => {
    const pool = new pg.Pool()
    const run = (marker: string, options: Parameters<typeof withPostgresQueryFailureForTest>[2]) =>
      withPostgresQueryFailureForTest(marker, async () => 1, options)
    await expect(run('SELECT', { pools: [pool] })).rejects.toThrow('leading query annotation')
    await expect(run(MARKER, { pools: [] })).rejects.toThrow('at least one pool')
    await expect(run(MARKER, { pools: [pool], requestId: 'a' })).rejects.toThrow('isOwnedRequest')
  })

  it('does not observe a client that connects after the scope ended', async () => {
    const pool = new pg.Pool()
    const original = { rows: [] }
    const client = new EventEmitter() as unknown as pg.PoolClient
    Object.assign(client, { query: async () => original, release: () => undefined })
    const queryBefore = Object.getOwnPropertyDescriptor(client, 'query')?.value
    Object.assign(pool, {
      connect: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return client
      },
    })
    let late: Promise<pg.PoolClient> | undefined
    await expect(
      withPostgresQueryFailureForTest(
        MARKER,
        async () => {
          late = pool.connect()
        },
        { pools: [pool] },
      ),
    ).rejects.toThrow('did not execute the targeted failed SQL')
    expect(await late).toBe(client)
    expect(Object.getOwnPropertyDescriptor(client, 'query')?.value).toBe(queryBefore)
  })

  it('rejects a server that accepts the division by zero', async () => {
    const pool = fakePool(async () => ({ rows: [] }))
    await expect(
      withPostgresQueryFailureForTest(
        MARKER,
        async () => {
          const client = await pool.connect()
          await client.query('BEGIN')
          await client.query({ text: `${MARKER} SELECT 1` })
        },
        { pools: [pool] },
      ),
    ).rejects.toThrow('unexpectedly accepted')
  })

  it('rethrows other errors from the division and the target statement', async () => {
    for (const [divisionCode, message] of [
      ['08006', 'division failed'],
      ['22012', 'target failed'],
    ] as const) {
      const pool = fakePool(async (text) => {
        if (text.includes('SELECT 1 / 0')) {
          throw Object.assign(new Error('division failed'), { code: divisionCode })
        }
        if (text.includes('orders:insert')) throw new Error('target failed')
        return { rows: [] }
      })
      await expect(
        withPostgresQueryFailureForTest(
          MARKER,
          async () => {
            const client = await pool.connect()
            await client.query('BEGIN')
            await client.query({ text: `${MARKER} SELECT 1` })
          },
          { pools: [pool] },
        ),
      ).rejects.toThrow(message)
    }
  })
})
