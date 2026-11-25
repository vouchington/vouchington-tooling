import { AsyncResource } from 'node:async_hooks'
import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import {
  acquireTestPostgresAdvisoryLock,
  createTestPostgresConnectionWaitPool,
  getPublicBaseTableNamesForTest,
  installPsqlPoolSocketTracking,
  observeTestPostgresLockQuery,
  readTestDatabaseTimestamp,
  registerPsqlPoolMetrics,
  testBlockedBackendHoldsRelation,
  type PsqlPoolMetric,
  type PsqlPoolSocketHandles,
  type QueryExecutor,
} from './index.mts'

describe('acquireTestPostgresAdvisoryLock', () => {
  it('acquires and idempotently releases exclusive and shared advisory locks', async () => {
    for (const mode of ['exclusive', 'shared'] as const) {
      const queries: Array<{ text: string; values: unknown[] | undefined }> = []
      const release = vi.fn()
      const client = {
        query: vi.fn(async (text: string, values?: unknown[]) => {
          queries.push({ text, values })
          return { rows: [{ unlocked: true }] }
        }),
        release,
      }
      const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool

      const lock = await acquireTestPostgresAdvisoryLock(pool, {
        namespace: 11,
        key: 22,
        timeout: '500ms',
        ...(mode === 'shared' ? { mode } : {}),
      })
      expect(queries.map((q) => q.text)).toEqual([
        'BEGIN',
        'SELECT set_config($1, $2, true)',
        mode === 'shared'
          ? '/* acquireTestPostgresAdvisoryLock */ SELECT pg_advisory_lock_shared($1, $2)'
          : '/* acquireTestPostgresAdvisoryLock */ SELECT pg_advisory_lock($1, $2)',
        'COMMIT',
      ])

      await lock.release()
      await lock.release()
      expect(release).toHaveBeenCalledTimes(1)
      expect(release).toHaveBeenCalledWith()
    }

    // Concurrent release() calls share one in-flight unlock promise instead of resolving early.
    let resolveUnlock!: (value: { rows: Array<{ unlocked: boolean }> }) => void
    const concurrentRelease = vi.fn()
    let unlockCalls = 0
    const concurrentPool = {
      connect: vi.fn(async () => ({
        query: vi.fn((text: string) => {
          if (text.includes('pg_advisory_unlock')) {
            unlockCalls += 1
            return new Promise<{ rows: Array<{ unlocked: boolean }> }>((resolve) => {
              resolveUnlock = resolve
            })
          }
          return Promise.resolve({ rows: [] })
        }),
        release: concurrentRelease,
      })),
    } as unknown as pg.Pool
    const concurrentLock = await acquireTestPostgresAdvisoryLock(concurrentPool, {
      namespace: 3,
      key: 4,
      timeout: '500ms',
    })
    let secondDone = false
    const firstRelease = concurrentLock.release()
    const secondRelease = concurrentLock.release().then(() => {
      secondDone = true
    })
    await Promise.resolve()
    expect(secondDone).toBe(false)
    expect(unlockCalls).toBe(1)
    resolveUnlock({ rows: [{ unlocked: true }] })
    await Promise.all([firstRelease, secondRelease])
    expect(secondDone).toBe(true)
    expect(concurrentRelease).toHaveBeenCalledTimes(1)
  })

  it('destroys the client when acquire or release fails or PostgreSQL reports unlocked=false', async () => {
    const releaseAcquire = vi.fn()
    const failPool = {
      connect: vi.fn(async () => ({
        query: vi.fn(async (text: string) => {
          if (text.includes('pg_advisory_lock')) throw 'acquire-failed-string'
          return { rows: [] }
        }),
        release: releaseAcquire,
      })),
    } as unknown as pg.Pool

    await expect(
      acquireTestPostgresAdvisoryLock(failPool, { namespace: 1, key: 2, timeout: '100ms' }),
    ).rejects.toBe('acquire-failed-string')
    expect(releaseAcquire).toHaveBeenCalledWith(expect.any(Error))

    const releaseUnlockFalse = vi.fn()
    const unlockFalsePool = {
      connect: vi.fn(async () => ({
        query: vi.fn(async (text: string) => ({
          rows: text.includes('pg_advisory_unlock') ? [{ unlocked: false }] : [],
        })),
        release: releaseUnlockFalse,
      })),
    } as unknown as pg.Pool

    const lock = await acquireTestPostgresAdvisoryLock(unlockFalsePool, {
      namespace: 1,
      key: 2,
      timeout: '100ms',
    })
    await expect(lock.release()).rejects.toThrow(
      'PostgreSQL did not release the test advisory lock',
    )
    expect(releaseUnlockFalse).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('observeTestPostgresLockQuery', () => {
  it('tracks selectedPending and pendingQueries, validates bindings, and restores descriptor', async () => {
    let resolvePending!: () => void
    const proto = {
      query(config: { text: string; values?: unknown[] }) {
        if (config.text.includes('sync-throw')) throw new Error('sync boom')
        return new Promise<void>((resolve) => {
          resolvePending = resolve
        })
      },
    }
    const client = Object.create(proto) as pg.PoolClient

    const obs = observeTestPostgresLockQuery(client, {
      marker: '/* lock:op */',
      binding: { index: 0, value: ['a', 'b'] },
    })

    // Non-object / callback / submit / wrong arity rejected.
    expect(() => (client.query as (sql: string) => unknown)('SELECT 1')).toThrow(
      'native Promise query configs',
    )
    expect(() =>
      (client.query as (c: unknown, cb: unknown) => unknown)({ text: 'SELECT 1' }, () => {}),
    ).toThrow('native Promise query configs')
    expect(() =>
      (client.query as (c: unknown) => unknown)({ text: 'SELECT 1', callback: () => {} }),
    ).toThrow('native Promise query configs')
    expect(() =>
      (client.query as (c: unknown) => unknown)({ text: 'SELECT 1', submit: () => {} }),
    ).toThrow('native Promise query configs')

    // Wrong binding rejected.
    expect(() => client.query({ text: '/* lock:op */ SELECT 1', values: [['a']] })).toThrow(
      'did not target the expected bound identity',
    )
    expect(() => client.query({ text: '/* lock:op */ SELECT 1' })).toThrow(
      'did not target the expected bound identity',
    )

    // Synchronous throw cleans up pending counts.
    expect(() => client.query({ text: '/* other */ sync-throw' })).toThrow('sync boom')
    expect(obs.pendingQueries).toBe(0)
    expect(obs.selectedPending).toBe(false)

    // Matching query sets selectedPending and rejects pipelined queries while active.
    const pending = client.query({ text: '  /* lock:op */ SELECT 1', values: [['a', 'b']] })
    expect(obs.pendingQueries).toBe(1)
    expect(obs.selectedPending).toBe(true)
    expect(() => client.query({ text: '/* other */ SELECT 1' })).toThrow('queued or pipelined')

    resolvePending()
    await pending
    expect(obs.pendingQueries).toBe(0)
    expect(obs.selectedPending).toBe(false)

    // Non-matching pending query also rejects a matching lock query until drained.
    const otherPending = client.query({ text: '/* other */ SELECT 1' })
    expect(obs.pendingQueries).toBe(1)
    expect(obs.selectedPending).toBe(false)
    expect(() => client.query({ text: '/* lock:op */ SELECT 1', values: [['a', 'b']] })).toThrow(
      'queued or pipelined',
    )
    resolvePending()
    await otherPending

    obs.restore()
    expect(Object.hasOwn(client, 'query')).toBe(false)

    // Own-property query descriptor is restored intact + string binding check.
    const ownQuery = vi.fn(async () => ({ rows: [] }))
    const ownClient = { query: ownQuery } as unknown as pg.PoolClient
    const obs2 = observeTestPostgresLockQuery(ownClient, {
      marker: '/* str */',
      binding: { index: 1, value: 'expected-id' },
    })
    await ownClient.query({ text: '/* str */ SELECT 1', values: ['x', 'expected-id'] })
    expect(() =>
      ownClient.query({ text: '/* str */ SELECT 1', values: ['x', 'wrong-id'] }),
    ).toThrow('did not target the expected bound identity')
    obs2.restore()
    expect(Reflect.get(ownClient, 'query')).toBe(ownQuery)

    // Restoring does not clobber a newer replacement wrapper on client.query.
    const obs3 = observeTestPostgresLockQuery(ownClient, {
      marker: '/* str */',
      binding: { index: 0, value: 'v' },
    })
    const replacement = vi.fn(async () => ({ rows: [] }))
    ;(ownClient as unknown as { query: unknown }).query = replacement
    obs3.restore()
    expect(Reflect.get(ownClient, 'query')).toBe(replacement)
  })
})

describe('createTestPostgresConnectionWaitPool', () => {
  it('delegates queryProbe, holdClient, and close to the constructed pool', async () => {
    const release = vi.fn()
    const query = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }))
    const connect = vi.fn(async () => ({ release }))
    const end = vi.fn(async () => undefined)
    let capturedConfig: pg.PoolConfig | undefined

    class FakePool {
      constructor(config: pg.PoolConfig) {
        capturedConfig = config
      }
      query = query
      connect = connect
      end = end
    }

    const waitPool = createTestPostgresConnectionWaitPool(
      { connectionString: 'postgres://localhost/test', connectionTimeoutMillis: 250, max: 1 },
      FakePool as unknown as new (config: pg.PoolConfig) => pg.Pool,
    )
    expect(capturedConfig).toEqual({
      connectionString: 'postgres://localhost/test',
      connectionTimeoutMillis: 250,
      max: 1,
    })

    await waitPool.queryProbe()
    expect(query).toHaveBeenCalledWith('/* createTestPostgresConnectionWaitPool */ SELECT 1')

    const done = await waitPool.holdClient()
    done()
    expect(release).toHaveBeenCalledOnce()

    await waitPool.close()
    expect(end).toHaveBeenCalledOnce()
  })
})

describe('database utilities and testBlockedBackendHoldsRelation', () => {
  it('reads UTC microsecond database timestamps and rejects malformed or missing values', async () => {
    const validExecutor: QueryExecutor = async () =>
      ({ rows: [{ database_timestamp: '2026-04-01T12:34:56.789012Z' }] }) as never
    await expect(readTestDatabaseTimestamp(validExecutor)).resolves.toBe(
      '2026-04-01T12:34:56.789012Z',
    )

    const emptyExecutor: QueryExecutor = async () => ({ rows: [] }) as never
    await expect(readTestDatabaseTimestamp(emptyExecutor)).rejects.toThrow(
      'missing database timestamp',
    )

    const malformedExecutor: QueryExecutor = async () =>
      ({ rows: [{ database_timestamp: '2026-04-01' }] }) as never
    await expect(readTestDatabaseTimestamp(malformedExecutor)).rejects.toThrow(
      'missing database timestamp',
    )
  })

  it('lists public base table names and checks blocked relation lock ownership', async () => {
    const tableExecutor: QueryExecutor = async () =>
      ({ rows: [{ table_name: 'users' }, { table_name: 'orders' }] }) as never
    await expect(getPublicBaseTableNamesForTest(tableExecutor)).resolves.toEqual(
      new Set(['users', 'orders']),
    )

    const holdsExecutor: QueryExecutor = async ({ text, values }) => {
      expect(text).toContain('current_database()')
      expect(text).toContain('pg_partition_tree($2::regclass)')
      expect(values).toEqual([42, 'orders'])
      return { rows: [{ holds: true }] } as never
    }
    await expect(testBlockedBackendHoldsRelation(holdsExecutor, 42, 'orders')).resolves.toBe(true)

    const emptyHoldsExecutor: QueryExecutor = async () => ({ rows: [] }) as never
    await expect(testBlockedBackendHoldsRelation(emptyHoldsExecutor, 42, 'orders')).resolves.toBe(
      false,
    )
  })

  it('registers pool metrics and tracks owned TCP handles across connect events and pre-existing clients', async () => {
    const handleA = { id: 'tcp-a' }
    const handleB = { id: 'tcp-b' }
    const tlsWrappedHandle = { id: 'tls-wrap', _parent: handleB }
    const poolA = Object.assign(new EventEmitter(), {
      totalCount: 3,
      idleCount: 1,
      waitingCount: 2,
      _clients: [
        { connection: { stream: { _handle: handleA } } },
        null,
        { connection: null },
        { connection: { stream: null } },
        { connection: { stream: { _handle: null } } },
      ],
    })
    const poolB = Object.assign(new EventEmitter(), {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
    })

    installPsqlPoolSocketTracking()
    // Exercise TCPWRAP init/destroy hook callbacks without binding a socket.
    const syntheticTcp = new AsyncResource('TCPWRAP')
    const syntheticNonTcp = new AsyncResource('OTHER')
    const poolsInput: Record<string, pg.Pool> = {
      primary: poolA as unknown as pg.Pool,
      replica: poolB as unknown as pg.Pool,
    }
    Object.defineProperty(poolsInput, '__proto__', {
      value: poolB as unknown as pg.Pool,
      enumerable: true,
      configurable: true,
    })
    registerPsqlPoolMetrics(poolsInput)
    // Re-registering skips duplicate listener attachment.
    registerPsqlPoolMetrics(poolsInput)

    poolB.emit('connect', { connection: { stream: { _handle: tlsWrappedHandle } } })

    const host = globalThis as typeof globalThis & Record<symbol, unknown>
    const readMetrics = host[Symbol.for('vitest-fork-leak-pool-metrics')] as () => Record<
      string,
      PsqlPoolMetric
    >
    const metrics = readMetrics()
    expect(Object.getPrototypeOf(metrics)).toBeNull()
    expect(metrics.primary).toEqual({ total: 3, idle: 1, nonIdleOrConnecting: 2, waiting: 2 })
    expect(metrics.replica).toEqual({ total: 1, idle: 1, nonIdleOrConnecting: 0, waiting: 0 })
    expect(Object.getOwnPropertyDescriptor(metrics, '__proto__')?.value).toEqual({
      total: 1,
      idle: 1,
      nonIdleOrConnecting: 0,
      waiting: 0,
    })

    const readSockets = host[
      Symbol.for('vitest-fork-leak-pool-socket-handles')
    ] as () => PsqlPoolSocketHandles
    expect(readSockets().active.has(syntheticTcp)).toBe(true)
    expect(readSockets().active.has(syntheticNonTcp)).toBe(false)
    syntheticTcp.emitDestroy()
    syntheticNonTcp.emitDestroy()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(readSockets().active.has(syntheticTcp)).toBe(false)

    // Seed active map to confirm owned filtering returns only handles marked via pool clients.
    const tracker = host[Symbol.for('vitest-fork-leak-tcp-resource-tracker')] as {
      active: Map<number, object>
    }
    const unownedHandle = { id: 'tcp-unowned' }
    tracker.active.set(-101, handleA)
    tracker.active.set(-102, handleB)
    tracker.active.set(-103, unownedHandle)
    try {
      const snapshot = readSockets()
      expect(snapshot.active.has(handleA)).toBe(true)
      expect(snapshot.active.has(unownedHandle)).toBe(true)
      expect(snapshot.owned.has(handleA)).toBe(true)
      expect(snapshot.owned.has(handleB)).toBe(true)
      expect(snapshot.owned.has(unownedHandle)).toBe(false)
    } finally {
      tracker.active.delete(-101)
      tracker.active.delete(-102)
      tracker.active.delete(-103)
    }
  })
})
