export {
  formatActiveResources,
  formatProcessResources,
  formatResourceCounts,
} from './vitest-process-resources.mts'
import {
  handshakeSettled,
  handshakeSnapshot,
  pendingPoolSocketEpisode,
  poolConnectionCounts,
  rawDetectorCheckpoint,
  samePoolCounts,
  type ForkLeakHandshakeSnapshot,
  type PoolMetrics,
  type PoolSocketHandles,
} from './vitest-fork-leak-handshake-samples.mts'
export {
  recordForkLeakCheckpoint,
  type ForkLeakHandshakeSnapshot,
} from './vitest-fork-leak-handshake-samples.mts'

// Two quiet event-loop turns settle a completed pool transition. The hard cap
// bounds slow handshakes; unresolved sockets retain their sampled history.
export const FORK_LEAK_HANDSHAKE_STABLE_OBSERVATIONS = 2
export const FORK_LEAK_HANDSHAKE_MAX_TURNS = 100

export type ForkLeakHandshakeSettlement = {
  snapshot: ForkLeakHandshakeSnapshot
  detectorSnapshot: ForkLeakHandshakeSnapshot
  observations: readonly ForkLeakHandshakeSnapshot[]
  coalesced: boolean
}

// A finite pool ramp is coalesced only when the async resource
// identities show that every new TCP socket belongs to a registered pool.
// Unowned or unresolved growth keeps its complete sample history for error
// diagnostics, while the detector receives only one real snapshot per test.
export async function waitForForkLeakHandshakeSettle(options: {
  readResources: () => readonly string[]
  readPoolMetrics: () => PoolMetrics | null
  readPoolSocketHandles: () => PoolSocketHandles | null
  waitForTurn: () => Promise<void>
  stableObservations?: number
  maxTurns?: number
}): Promise<ForkLeakHandshakeSettlement> {
  const waitForTurn = options.waitForTurn
  const stableObservations = options.stableObservations ?? FORK_LEAK_HANDSHAKE_STABLE_OBSERVATIONS
  const maxTurns = options.maxTurns ?? FORK_LEAK_HANDSHAKE_MAX_TURNS
  const initial = handshakeSnapshot(
    options.readResources(),
    options.readPoolSocketHandles()?.active ?? new Set(),
    options.readPoolMetrics(),
  )
  if (initial.poolMetrics === null) {
    return {
      snapshot: initial,
      detectorSnapshot: initial,
      observations: [initial],
      coalesced: false,
    }
  }

  const initialPool = poolConnectionCounts(initial.poolMetrics)
  const initialHandles = options.readPoolSocketHandles()
  const probeMetrics = options.readPoolMetrics()
  const probeHandles = options.readPoolSocketHandles()
  const probe = handshakeSnapshot(
    options.readResources(),
    probeHandles?.active ?? new Set(),
    probeMetrics,
  )
  if (probeMetrics === null || probeHandles === null || initialHandles === null) {
    return {
      snapshot: probe,
      detectorSnapshot: probe,
      observations: [initial, probe],
      coalesced: false,
    }
  }
  const probePool = poolConnectionCounts(probeMetrics)
  const poolTransitionPending =
    initialPool.nonIdleOrConnecting > 0 || probePool.total > initialPool.total
  if (!poolTransitionPending) {
    return { snapshot: probe, detectorSnapshot: probe, observations: [probe], coalesced: false }
  }

  let previous = probe
  let previousPool = probePool
  let stable = 0
  const observations = [initial, probe]
  const ownedHandlesObserved = new Set(probeHandles.owned)
  const unownedGrowthSnapshots = new Map<object, ForkLeakHandshakeSnapshot>()
  for (const handle of probe.tcpSocketHandles) {
    if (!initial.tcpSocketHandles.has(handle) && !probeHandles.owned.has(handle)) {
      unownedGrowthSnapshots.set(handle, probe)
    }
  }
  let pendingEpisodeHandle: object | null = null
  for (let turn = 0; turn < maxTurns && stable < stableObservations; turn += 1) {
    await waitForTurn()
    const currentHandles = options.readPoolSocketHandles()
    const currentMetrics = options.readPoolMetrics()
    const current = handshakeSnapshot(
      options.readResources(),
      currentHandles?.active ?? new Set(),
      currentMetrics,
    )
    observations.push(current)
    if (currentMetrics === null || currentHandles === null) {
      return {
        snapshot: current,
        detectorSnapshot: rawDetectorCheckpoint({
          current,
          ownedHandlesObserved,
          unownedGrowthSnapshots,
        }),
        observations,
        coalesced: false,
      }
    }
    for (const handle of currentHandles.owned) ownedHandlesObserved.add(handle)
    for (const handle of current.tcpSocketHandles) {
      if (
        !initial.tcpSocketHandles.has(handle) &&
        !currentHandles.owned.has(handle) &&
        !unownedGrowthSnapshots.has(handle)
      ) {
        unownedGrowthSnapshots.set(handle, current)
      }
    }
    const currentPool = poolConnectionCounts(currentMetrics)
    stable =
      handshakeSettled(previous, current) && samePoolCounts(previousPool, currentPool)
        ? stable + 1
        : 0
    const pendingEpisode = pendingPoolSocketEpisode({
      initial,
      probe,
      current,
      initialPool,
      currentPool,
      ownedHandlesObserved,
      previousHandle: pendingEpisodeHandle,
    })
    pendingEpisodeHandle = pendingEpisode.handle
    const pendingEpisodeInFlight = pendingEpisode.inFlight
    if (stable >= stableObservations && pendingEpisodeInFlight) stable = 0
    previous = current
    previousPool = currentPool
    if (stable >= stableObservations) {
      const initialTcpHandles = initial.tcpSocketHandles
      const observedGrowthHandles = new Set(
        [...current.tcpSocketHandles].filter((handle) => !initialTcpHandles.has(handle)),
      )
      const tcpCountGrowth = current.tcpSockets - initial.tcpSockets
      const identitiesAccountForAllGrowth = observedGrowthHandles.size === tcpCountGrowth
      const unresolvedGrowthWasObserved = [...unownedGrowthSnapshots.keys()].some(
        (handle) => !ownedHandlesObserved.has(handle),
      )
      const allGrowthIsPoolOwned =
        identitiesAccountForAllGrowth &&
        !unresolvedGrowthWasObserved &&
        [...observedGrowthHandles].every(
          (handle) => currentHandles.owned.has(handle) || ownedHandlesObserved.has(handle),
        )
      const detectorSnapshot = rawDetectorCheckpoint({
        current,
        ownedHandlesObserved,
        unownedGrowthSnapshots,
      })
      // A stable nonzero ConnectWrap may be a slow pool handshake under runner
      // contention. Preserve it as raw evidence instead of treating it as done.
      return {
        snapshot: current,
        detectorSnapshot,
        observations,
        coalesced: allGrowthIsPoolOwned && current.connectWraps === 0,
      }
    }
  }

  return {
    snapshot: previous,
    detectorSnapshot: rawDetectorCheckpoint({
      current: previous,
      ownedHandlesObserved,
      unownedGrowthSnapshots,
    }),
    observations,
    coalesced: false,
  }
}
