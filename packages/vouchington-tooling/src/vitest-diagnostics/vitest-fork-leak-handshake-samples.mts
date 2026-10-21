import { countResourcesByType } from './vitest-process-resources.mts'

export type PoolConnectionMetrics = {
  total: number
  idle: number
  nonIdleOrConnecting: number
  waiting: number
}

export type PoolMetrics = Readonly<Record<string, PoolConnectionMetrics>>

export type PoolSocketHandles = { active: ReadonlySet<object>; owned: ReadonlySet<object> }

const pendingEpisodeKey = Symbol.for('vitest-fork-leak-pending-pool-socket-episodes')

type PendingEpisodeGlobal = typeof globalThis & Record<symbol, WeakSet<object> | undefined>

function pendingPoolSocketEpisodes(): WeakSet<object> {
  return ((globalThis as PendingEpisodeGlobal)[pendingEpisodeKey] ??= new WeakSet<object>())
}

function startPendingPoolSocketEpisode(
  growthHandles: readonly object[],
  ownedHandles: ReadonlySet<object>,
): object | null {
  const candidate = growthHandles.find(
    (handle) => !ownedHandles.has(handle) && !pendingPoolSocketEpisodes().has(handle),
  )
  if (candidate) pendingPoolSocketEpisodes().add(candidate)
  return candidate ?? null
}

export function pendingPoolSocketEpisode(options: {
  initial: ForkLeakHandshakeSnapshot
  probe: ForkLeakHandshakeSnapshot
  current: ForkLeakHandshakeSnapshot
  initialPool: PoolConnectionCounts
  currentPool: PoolConnectionCounts
  ownedHandlesObserved: ReadonlySet<object>
  previousHandle: object | null
}): { handle: object | null; inFlight: boolean } {
  const growthHandles = [...options.current.tcpSocketHandles].filter(
    (handle) => !options.initial.tcpSocketHandles.has(handle),
  )
  const capacity = Math.max(0, options.currentPool.total - options.initialPool.total)
  const newlyOwned = growthHandles.filter((handle) =>
    options.ownedHandlesObserved.has(handle),
  ).length
  const initialUnowned = [...options.initial.tcpSocketHandles].filter(
    (handle) => !options.ownedHandlesObserved.has(handle),
  )
  const initialPending = options.currentPool.nonIdleOrConnecting > 0 && initialUnowned.length > 0
  const newPending = options.currentPool.nonIdleOrConnecting > 0 && newlyOwned < capacity
  const candidates = newPending
    ? growthHandles
    : initialPending
      ? [...options.current.tcpSocketHandles].filter((handle) =>
          options.initial.tcpSocketHandles.has(handle),
        )
      : []
  const handle =
    startPendingPoolSocketEpisode(candidates, options.ownedHandlesObserved) ??
    options.previousHandle
  return {
    handle,
    inFlight:
      handle !== null &&
      options.current.tcpSocketHandles.has(handle) &&
      !options.ownedHandlesObserved.has(handle),
  }
}

export type ForkLeakHandshakeSnapshot = {
  connectWraps: number
  tcpSockets: number
  resources: readonly string[]
  tcpSocketHandles: ReadonlySet<object>
  poolMetrics: PoolMetrics | null
}

export function recordForkLeakCheckpoint<T>(
  record: (counts: ReadonlyMap<string, number>, testFile: string) => T[],
  settlement: {
    snapshot: ForkLeakHandshakeSnapshot
    detectorSnapshot: ForkLeakHandshakeSnapshot
    coalesced: boolean
  },
  testFile: string,
): T[] {
  const checkpoint = settlement.coalesced ? settlement.snapshot : settlement.detectorSnapshot
  return record(countResourcesByType(checkpoint.resources), testFile)
}

export type PoolConnectionCounts = {
  total: number
  idle: number
  nonIdleOrConnecting: number
  waiting: number
}

export function handshakeSnapshot(
  resources: readonly string[],
  tcpSocketHandles: ReadonlySet<object>,
  poolMetrics: PoolMetrics | null,
): ForkLeakHandshakeSnapshot {
  const counts = countResourcesByType(resources)
  return {
    connectWraps: counts.get('ConnectWrap') ?? 0,
    tcpSockets: counts.get('TCPSocketWrap') ?? 0,
    resources,
    tcpSocketHandles,
    poolMetrics,
  }
}

export function poolConnectionCounts(metrics: PoolMetrics): PoolConnectionCounts {
  const counts = { total: 0, idle: 0, nonIdleOrConnecting: 0, waiting: 0 }
  for (const pool of Object.values(metrics)) {
    counts.total += pool.total
    counts.idle += pool.idle
    counts.nonIdleOrConnecting += pool.nonIdleOrConnecting
    counts.waiting += pool.waiting
  }
  return counts
}

export function samePoolCounts(
  previous: PoolConnectionCounts,
  current: PoolConnectionCounts,
): boolean {
  return (
    previous.total === current.total &&
    previous.idle === current.idle &&
    previous.nonIdleOrConnecting === current.nonIdleOrConnecting &&
    previous.waiting === current.waiting
  )
}

export function handshakeSettled(
  previous: ForkLeakHandshakeSnapshot,
  current: ForkLeakHandshakeSnapshot,
): boolean {
  return (
    previous.connectWraps === current.connectWraps && previous.tcpSockets === current.tcpSockets
  )
}

export function rawDetectorCheckpoint(options: {
  current: ForkLeakHandshakeSnapshot
  ownedHandlesObserved: ReadonlySet<object>
  unownedGrowthSnapshots: ReadonlyMap<object, ForkLeakHandshakeSnapshot>
}): ForkLeakHandshakeSnapshot {
  const firstUnresolvedSample = [...options.unownedGrowthSnapshots].find(
    ([handle]) => !options.ownedHandlesObserved.has(handle),
  )?.[1]
  return firstUnresolvedSample ?? options.current
}
