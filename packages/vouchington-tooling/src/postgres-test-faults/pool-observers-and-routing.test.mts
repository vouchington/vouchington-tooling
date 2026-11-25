import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import {
  clientQueryText,
  observePostgresReadRoutingForTest,
  observeTestPostgresClientQueries,
  observeTestPostgresQueryPools,
  runPoolObservationExclusively,
  tapClientQueries,
  type ObservedClientQuery,
} from './index.mts'

describe('query-pool-observer', () => {
  it('extracts query text for strings, objects, and unknown values', () => {
    expect(clientQueryText('SELECT 1')).toBe('SELECT 1')
    expect(clientQueryText({ text: 'SELECT 2' })).toBe('SELECT 2')
    expect(clientQueryText(null)).toBe('')
    expect(clientQueryText(42)).toBe('')
  })

  it('observes pool.query across labeled pools, supports nested same-marker calls, and restores descriptors', async () => {
    const readQuery = vi.fn(async () => ({ rows: [] }))
    const writeProto = { query: vi.fn(async () => ({ rows: [] })) }
    const readPool = { query: readQuery } as unknown as pg.Pool
    const writePool = Object.create(writeProto) as pg.Pool
    const completed: string[] = []

    const outcome = await observeTestPostgresQueryPools(
      { read: readPool, write: writePool },
      '/* marker */',
      async () => {
        await readPool.query('/* marker */ SELECT 1')
        await writePool.query({ text: '/* unmatched */ SELECT 2' })
        // Nested observation with same marker reuses active context.
        const nested = await observeTestPostgresQueryPools(
          { read: readPool, write: writePool },
          '/* marker */',
          async () => {
            await writePool.query({ text: '/* marker */ INSERT 1' })
            return 'inner'
          },
        )
        expect(nested).toEqual({ result: 'inner', pools: ['read', 'write'] })

        // Nested observation with a different marker rejects.
        await expect(
          observeTestPostgresQueryPools(
            { read: readPool, write: writePool },
            '/* different */',
            async () => 'nope',
          ),
        ).rejects.toThrow('Nested PostgreSQL pool observations must use the same query marker')

        return 'outer'
      },
      async () => {
        completed.push('done')
      },
    )

    expect(outcome).toEqual({ result: 'outer', pools: ['read', 'write'] })
    expect(completed).toEqual(['done', 'done'])
    expect(Reflect.get(readPool, 'query')).toBe(readQuery)
    expect(Object.hasOwn(writePool, 'query')).toBe(false)
  })

  it('taps borrowed client queries, handles callbacks, sync values, replaced queries, and null clients', async () => {
    const queries: ObservedClientQuery<'read' | 'write'>[] = []
    const completed: ObservedClientQuery<'read' | 'write'>[] = []

    const ownClientQuery = vi.fn(async () => ({ rows: [] }))
    const ownClient = { query: ownClientQuery }
    const protoClientProto = {
      query: vi.fn((...args: unknown[]) => {
        if (typeof args[1] === 'function') {
          ;(args[1] as (err: null, res: object) => void)(null, { rows: [] })
          return undefined
        }
        if (typeof args[0] === 'string' && args[0] === 'SYNC') return 'sync-result'
        return Promise.resolve({ rows: [] })
      }),
    }
    const protoClient = Object.create(protoClientProto) as {
      query: (...args: unknown[]) => unknown
    }
    const replacedClient = { query: vi.fn(async () => ({ rows: [] })) }

    let nextClient = 0
    const clients = [ownClient, protoClient, replacedClient, null]
    const readPool = {
      connect: vi.fn((cb?: (err: null, client: unknown) => void) => {
        if (typeof cb === 'function') {
          cb(null, ownClient)
          return undefined
        }
        return Promise.resolve(clients[nextClient++])
      }),
    } as unknown as pg.Pool
    const writeProto = {
      connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })) })),
    }
    const writePool = Object.create(writeProto) as pg.Pool

    const restore = tapClientQueries(readPool, 'read', queries, async (q) => {
      completed.push(q)
    })

    // Callback connect passes straight through.
    let cbClient: unknown
    ;(readPool.connect as unknown as (cb: (err: null, c: unknown) => void) => void)((_e, c) => {
      cbClient = c
    })
    expect(cbClient).toBe(ownClient)

    const c1 = (await readPool.connect()) as unknown as typeof ownClient
    await (c1.query as (input: unknown) => Promise<unknown>)({ text: 'SELECT $1', values: ['v1'] })

    const c2 = (await readPool.connect()) as unknown as typeof protoClient
    await c2.query('SELECT $1', ['v2'])
    expect(c2.query('SYNC')).toBe('sync-result')
    c2.query('CALLBACK', () => {})

    const c3 = (await readPool.connect()) as unknown as typeof replacedClient
    const replacement = vi.fn(async () => ({ rows: [] }))
    c3.query = replacement

    // Nullish client from connect passes through safely.
    expect(await readPool.connect()).toBeNull()

    restore()
    expect(ownClient.query).toBe(ownClientQuery)
    expect(Object.hasOwn(protoClient, 'query')).toBe(false)
    expect(c3.query).toBe(replacement)
    expect(queries).toHaveLength(4)
    expect(completed).toHaveLength(2)

    // observeTestPostgresClientQueries records across pools and ignores late completions after return.
    let resolveLate!: () => void
    const lateClient = {
      query: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveLate = resolve
          }),
      ),
    }
    const latePool = { connect: vi.fn(async () => lateClient) } as unknown as pg.Pool
    const lateCompleted: string[] = []
    let lateQuery!: Promise<unknown>
    const observed = await observeTestPostgresClientQueries(
      { write: writePool, late: latePool },
      async () => {
        const w = await writePool.connect()
        await w.query('SELECT 1')
        const l = await latePool.connect()
        lateQuery = l.query('SELECT 2')
        return 123
      },
      async (q) => {
        lateCompleted.push(q.text)
      },
    )
    resolveLate()
    await lateQuery
    expect(observed.result).toBe(123)
    expect(observed.queries.map((q) => q.text)).toEqual(['SELECT 1', 'SELECT 2'])
    expect(lateCompleted).toEqual(['SELECT 1'])
    expect(Object.hasOwn(writePool, 'connect')).toBe(false)
  })
})

describe('observePostgresReadRoutingForTest', () => {
  it('counts Promise and callback checkouts per AsyncLocalStorage scope and shares one proxy per pool', async () => {
    const primaryProto = {
      connect(cb?: (err: Error | null, client?: object) => void) {
        if (typeof cb === 'function') {
          cb(null, { id: 'cb-primary' })
          return undefined
        }
        return Promise.resolve({ id: 'promise-primary' })
      },
    }
    const ownReplicaConnect = (cb?: (err: Error | null, client?: object) => void) => {
      if (typeof cb === 'function') {
        cb(new Error('connect failed'))
        return undefined
      }
      return Promise.resolve({ id: 'promise-replica' })
    }
    const primary = Object.create(primaryProto) as pg.Pool
    const replica = { connect: ownReplicaConnect } as unknown as pg.Pool

    const observerA = await observePostgresReadRoutingForTest({ primary, replica })
    const observerB = await observePostgresReadRoutingForTest({ primary, replica })

    // Unscoped checkouts are not counted.
    await primary.connect()
    expect(observerA.primaryAcquisitions()).toBe(0)

    await observerA.run(async () => {
      await primary.connect()
      await replica.connect()
      // Callback success increments; callback error does not.
      await new Promise<void>((resolve) => {
        ;(primary.connect as unknown as (cb: (e: Error | null, c?: object) => void) => void)(() =>
          resolve(),
        )
      })
      await new Promise<void>((resolve) => {
        ;(replica.connect as unknown as (cb: (e: Error | null, c?: object) => void) => void)(() =>
          resolve(),
        )
      })
    })

    expect(observerA.primaryAcquisitions()).toBe(2)
    expect(observerA.replicaAcquisitions()).toBe(1)
    expect(observerB.primaryAcquisitions()).toBe(0)

    // Nested close inside runPoolObservationExclusively rejects and remains retryable.
    await runPoolObservationExclusively(async () => {
      await expect(observerA.close()).rejects.toThrow()
    })

    // Closing observerA while observerB is active keeps proxy alive.
    await observerA.close()
    // After close, checkouts inside observerA.run are not counted.
    await observerA.run(async () => {
      await primary.connect()
      await replica.connect()
    })
    expect(observerA.primaryAcquisitions()).toBe(2)
    expect(observerA.replicaAcquisitions()).toBe(1)

    await observerB.run(async () => {
      await replica.connect()
    })
    expect(observerB.replicaAcquisitions()).toBe(1)

    await observerB.close()
    expect(Object.hasOwn(primary, 'connect')).toBe(false)
    expect(Reflect.get(replica, 'connect')).toBe(ownReplicaConnect)

    // When close() runs while primary/replica checkouts are in flight, late acquisitions do not count.
    let resolvePrimary!: (c: object) => void
    let resolveReplica!: (c: object) => void
    const deferredPrimary = {
      connect: () => new Promise<object>((resolve) => (resolvePrimary = resolve)),
    } as unknown as pg.Pool
    const deferredReplica = {
      connect: () => new Promise<object>((resolve) => (resolveReplica = resolve)),
    } as unknown as pg.Pool
    const observerD = await observePostgresReadRoutingForTest({
      primary: deferredPrimary,
      replica: deferredReplica,
    })
    let pendingPrimary!: Promise<unknown>
    let pendingReplica!: Promise<unknown>
    await observerD.run(async () => {
      pendingPrimary = deferredPrimary.connect()
      pendingReplica = deferredReplica.connect()
    })
    // Trigger close() while a competing observation blocks listener removal so closed===true is observed.
    await runPoolObservationExclusively(async () => {
      const failedClose = observerD.close().catch(() => undefined)
      resolvePrimary({ id: 'late-p' })
      resolveReplica({ id: 'late-r' })
      await Promise.all([pendingPrimary, pendingReplica, failedClose])
    })
    expect(observerD.primaryAcquisitions()).toBe(0)
    expect(observerD.replicaAcquisitions()).toBe(0)
    await observerD.close()

    // When another wrapper replaces pool.connect before close, close leaves the replacement intact.
    const observerC = await observePostgresReadRoutingForTest({ primary, replica })
    const replacement = vi.fn(async () => ({ id: 'replacement' }))
    ;(replica as unknown as { connect: unknown }).connect = replacement
    await observerC.close()
    expect(Reflect.get(replica, 'connect')).toBe(replacement)
  })
})
