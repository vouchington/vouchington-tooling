import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { abortTestPostgresTransaction } from './aborted-transaction.mts'
import {
  discardTestPostgresClient,
  reserveTestPostgresObserver,
  trackTestPostgresClientEnd,
} from './client-loan.mts'
import { tryStartTestCluster, type TestCluster } from './test-cluster.test-helpers.mts'

const started = await tryStartTestCluster()

describe.skipIf(!started)('client loan helpers (real PostgreSQL)', () => {
  afterAll(() => started?.stop())
  const cluster = () => started as TestCluster

  it('reserves an observer and returns it to the pool when not discarded', async () => {
    const pool = cluster().createPool(2)
    const observer = reserveTestPostgresObserver(pool)
    expect(observer.client).toBeUndefined()
    const client = await observer.ready
    expect(observer.client).toBe(client)
    await observer.release(false)
    await observer.release(false)
    expect(pool.idleCount).toBe(1)
  })

  it('destroys a discarded observer and waits for its connection to end', async () => {
    const pool = cluster().createPool(2)
    const observer = reserveTestPostgresObserver(pool)
    await observer.ready
    await observer.release(true)
    expect(pool.totalCount).toBe(0)
  })

  it('releases nothing when the observer checkout failed', async () => {
    const pool = cluster().createPool(2)
    const failure = new Error('connect failed')
    vi.spyOn(pool, 'connect').mockRejectedValueOnce(failure)
    const observer = reserveTestPostgresObserver(pool)
    await expect(observer.ready).rejects.toBe(failure)
    await expect(observer.release(true)).resolves.toBeUndefined()
  })

  it('discards a client with an end listener it removes afterwards', async () => {
    const pool = cluster().createPool(2)
    const client = await pool.connect()
    const ended = trackTestPostgresClientEnd(client)
    expect(client.listenerCount('end')).toBeGreaterThan(0)
    await discardTestPostgresClient(client, ended)
    expect(pool.totalCount).toBe(0)
  })

  it('poisons a real transaction so the next statement answers 25P02', async () => {
    const pool = cluster().createPool(2)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await abortTestPostgresTransaction(client)
      await expect(client.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' })
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})

describe('abortTestPostgresTransaction', () => {
  it('rethrows an error other than division by zero', async () => {
    const failure = new Error('connection lost')
    await expect(
      abortTestPostgresTransaction({ query: () => Promise.reject(failure) } as never),
    ).rejects.toBe(failure)
  })

  it('rejects a server that accepts the division', async () => {
    const client = Object.assign(new EventEmitter(), {
      query: () => Promise.resolve({ rows: [] }),
    }) as unknown as Pick<pg.PoolClient, 'query'>
    await expect(abortTestPostgresTransaction(client)).rejects.toThrow('unexpectedly accepted')
  })
})
