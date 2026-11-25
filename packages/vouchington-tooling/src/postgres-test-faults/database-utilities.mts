import { createHook } from 'node:async_hooks'
import type pg from 'pg'
import type { QueryExecutor } from './fault-types.mts'

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

/** Reads PostgreSQL's UTC `clock_timestamp()` with microsecond precision. */
export async function readTestDatabaseTimestamp(executor: QueryExecutor): Promise<string> {
  const { rows } = await executor<{ database_timestamp: string }>({
    text: `/* readTestDatabaseTimestamp */
      SELECT to_char(
        clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS database_timestamp`,
  })
  const value = rows[0]?.database_timestamp
  if (typeof value === 'string' && UTC_TIMESTAMP_PATTERN.test(value)) {
    return value
  }
  throw new Error('readTestDatabaseTimestamp: missing database timestamp')
}

/** Lists all base table names in the `public` schema. */
export async function getPublicBaseTableNamesForTest(
  executor: QueryExecutor,
): Promise<Set<string>> {
  const { rows } = await executor<{ table_name: string }>({
    text: `/* getPublicBaseTableNamesForTest */
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'`,
  })
  return new Set(rows.map((row) => row.table_name))
}

export type PsqlPoolMetric = {
  total: number
  idle: number
  nonIdleOrConnecting: number
  waiting: number
}

export type PsqlPoolSocketHandles = {
  active: ReadonlySet<object>
  owned: ReadonlySet<object>
}

type TcpResourceTracker = {
  active: Map<number, object>
  owned: WeakSet<object>
  registeredPools: WeakSet<object>
  hookInstalled: boolean
}

const trackerKey = Symbol.for('vitest-fork-leak-tcp-resource-tracker')
const poolMetricsKey = Symbol.for('vitest-fork-leak-pool-metrics')
const poolSocketHandlesKey = Symbol.for('vitest-fork-leak-pool-socket-handles')

function getTcpResourceTracker(): TcpResourceTracker {
  const host = globalThis as typeof globalThis & Record<symbol, TcpResourceTracker | undefined>
  const existing = host[trackerKey]
  if (existing) return existing
  const created: TcpResourceTracker = {
    active: new Map(),
    owned: new WeakSet(),
    registeredPools: new WeakSet(),
    hookInstalled: false,
  }
  host[trackerKey] = created
  return created
}

/** Installs an async hook tracking live `TCPWRAP` resources for pool socket ownership checks. */
export function installPsqlPoolSocketTracking(): void {
  const tracker = getTcpResourceTracker()
  if (tracker.hookInstalled) return
  tracker.hookInstalled = true
  createHook({
    init(asyncId, type, _triggerAsyncId, resource) {
      if (type === 'TCPWRAP' && typeof resource === 'object' && resource !== null) {
        tracker.active.set(asyncId, resource)
      }
    },
    destroy(asyncId) {
      tracker.active.delete(asyncId)
    },
  }).enable()
}

/**
 * Registers named `pg.Pool` instances for Vitest fork-leak pool metrics and socket ownership
 * diagnostics under the standard `Symbol.for('vitest-fork-leak-pool-*')` hooks.
 */
export function registerPsqlPoolMetrics<Name extends string>(
  pools: Readonly<Record<Name, pg.Pool>>,
): void {
  const tracker = getTcpResourceTracker()
  installPsqlPoolSocketTracking()
  const entries = Object.entries(pools) as Array<[Name, pg.Pool]>
  for (const [, pool] of entries) {
    if (!tracker.registeredPools.has(pool)) {
      tracker.registeredPools.add(pool)
      pool.on('connect', (client) => markPoolTcpResource(tracker, client))
    }
    // A reset module graph can connect before its pools are registered at the next checkpoint.
    const clients: unknown = Reflect.get(pool, '_clients')
    if (Array.isArray(clients)) {
      for (const client of clients) markPoolTcpResource(tracker, client)
    }
  }

  const host = globalThis as typeof globalThis & Record<symbol, unknown>
  host[poolMetricsKey] = (): Record<Name, PsqlPoolMetric> => {
    const metrics = Object.create(null) as Record<Name, PsqlPoolMetric>
    for (const [name, pool] of entries) {
      metrics[name] = snapshotPool(pool)
    }
    return metrics
  }
  host[poolSocketHandlesKey] = (): PsqlPoolSocketHandles => {
    const active = new Set(tracker.active.values())
    return {
      active,
      owned: new Set([...active].filter((resource) => tracker.owned.has(resource))),
    }
  }
}

function markPoolTcpResource(tracker: TcpResourceTracker, client: unknown): void {
  if (typeof client !== 'object' || client === null) return
  const connection: unknown = Reflect.get(client, 'connection')
  if (typeof connection !== 'object' || connection === null) return
  const stream: unknown = Reflect.get(connection, 'stream')
  if (typeof stream !== 'object' || stream === null) return
  let streamHandle: unknown = Reflect.get(stream, '_handle')
  while (typeof streamHandle === 'object' && streamHandle !== null) {
    tracker.owned.add(streamHandle)
    streamHandle = Reflect.get(streamHandle, '_parent')
  }
}

function snapshotPool(pool: pg.Pool): PsqlPoolMetric {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    nonIdleOrConnecting: pool.totalCount - pool.idleCount,
    waiting: pool.waitingCount,
  }
}
