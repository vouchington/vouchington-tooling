import { describe, expect, it } from 'vitest'
import { createForkLeakDetector } from './vitest-fork-leak-detection.mts'
import type { PoolMetrics, PoolSocketHandles } from './vitest-fork-leak-handshake-samples.mts'
import {
  recordForkLeakCheckpoint,
  waitForForkLeakHandshakeSettle,
  type ForkLeakHandshakeSnapshot,
  type ForkLeakHandshakeSettlement,
} from './vitest-fork-leak-handshake.mts'

function poolMetrics(total: number, idle = total): PoolMetrics {
  const metric = { total, idle, nonIdleOrConnecting: total - idle, waiting: 0 }
  const empty = { total: 0, idle: 0, nonIdleOrConnecting: 0, waiting: 0 }
  return { write: metric, read: empty, advisoryLock: empty, jobSerialization: empty }
}

function socketHandles(active: readonly object[], owned: readonly object[]): PoolSocketHandles {
  return { active: new Set(active), owned: new Set(owned) }
}

function recordAll(detector: ReturnType<typeof createForkLeakDetector>, counts: readonly number[]) {
  return counts.flatMap((count) => detector.record(new Map([['TCPSocketWrap', count]])))
}

describe('fork-leak handshake settlement', () => {
  it('coalesces a serial TCP burst only when every new handle is marked pool-owned', async () => {
    let tcpSockets = 4
    let connectWraps = 1
    let poolTotal = 4
    let poolIdle = 3
    const tcpHandles = Array.from({ length: tcpSockets }, () => ({}))
    const ownedHandles = [...tcpHandles]
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        ...Array.from({ length: connectWraps }, () => 'ConnectWrap'),
      ],
      readPoolMetrics: () => poolMetrics(poolTotal, poolIdle),
      readPoolSocketHandles: () => socketHandles(tcpHandles, ownedHandles),
      stableObservations: 2,
      maxTurns: 20,
      waitForTurn: async () => {
        if (tcpSockets < 8) {
          tcpSockets += 1
          poolTotal += 1
          poolIdle += 1
          const socketHandle = {}
          tcpHandles.push(socketHandle)
          ownedHandles.push(socketHandle)
          return
        }
        connectWraps = 0
        poolIdle = poolTotal
      },
    })

    expect(result.coalesced).toBe(true)
    expect(result.snapshot).toMatchObject({ connectWraps: 0, tcpSockets: 8 })
    expect(result.snapshot.resources).toHaveLength(8)
  })

  it('returns every checkpoint when a TCP handle remains unowned', async () => {
    let tcpSockets = 4
    let poolTotal = 4
    let turns = 0
    const tcpHandles = Array.from({ length: tcpSockets }, () => ({}))
    const ownedHandles = [...tcpHandles]
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        'ConnectWrap',
      ],
      readPoolMetrics: () => poolMetrics(poolTotal, 3),
      readPoolSocketHandles: () => socketHandles(tcpHandles, ownedHandles),
      maxTurns: 3,
      waitForTurn: async () => {
        turns += 1
        if (turns === 1) {
          tcpSockets += 1
          poolTotal += 1
          tcpHandles.push({})
        }
      },
    })

    expect(result.coalesced).toBe(false)
    expect(result.observations.map((observation) => observation.tcpSockets)).toEqual([
      4, 4, 5, 5, 5,
    ])
    expect(result.detectorSnapshot.tcpSockets).toBe(5)
  })

  it('preserves TCP growth when the transport handle cannot be identified', async () => {
    let tcpSockets = 1
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        'ConnectWrap',
      ],
      readPoolMetrics: () => poolMetrics(1, 0),
      readPoolSocketHandles: () => socketHandles([], []),
      waitForTurn: async () => {
        tcpSockets = 2
      },
    })

    expect(result.coalesced).toBe(false)
    expect(result.observations.map((observation) => observation.tcpSockets)).toEqual([
      1, 1, 2, 2, 2,
    ])
  })

  it('preserves an unrelated socket alongside a completed pool connection', async () => {
    let tcpSockets = 4
    let poolTotal = 4
    let poolIdle = 3
    const tcpHandles = Array.from({ length: tcpSockets }, () => ({}))
    const ownedHandles = [...tcpHandles]
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        'ConnectWrap',
      ],
      readPoolMetrics: () => poolMetrics(poolTotal, poolIdle),
      readPoolSocketHandles: () => socketHandles(tcpHandles, ownedHandles),
      waitForTurn: async () => {
        if (tcpSockets === 4) {
          tcpSockets += 2
          poolTotal += 1
          poolIdle += 1
          const poolSocket = {}
          const testSocket = {}
          tcpHandles.push(poolSocket, testSocket)
          ownedHandles.push(poolSocket)
        }
      },
    })

    expect(result.coalesced).toBe(false)
    expect(result.observations.map((observation) => observation.tcpSockets)).toEqual([
      4, 4, 6, 6, 6,
    ])
  })

  it('records the first checkpoint containing later unowned growth after owned pool growth', async () => {
    let tcpSockets = 4
    let poolTotal = 4
    let poolIdle = 3
    let turns = 0
    const tcpHandles = Array.from({ length: tcpSockets }, () => ({}))
    const ownedHandles = [...tcpHandles]
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        ...(turns < 3 ? ['ConnectWrap'] : []),
      ],
      readPoolMetrics: () => poolMetrics(poolTotal, poolIdle),
      readPoolSocketHandles: () => socketHandles(tcpHandles, ownedHandles),
      waitForTurn: async () => {
        turns += 1
        if (turns === 1) {
          tcpSockets += 1
          poolTotal += 1
          poolIdle += 1
          const poolSocket = {}
          tcpHandles.push(poolSocket)
          ownedHandles.push(poolSocket)
        } else if (turns === 2) {
          tcpSockets += 1
          tcpHandles.push({})
        }
      },
    })

    expect(result.coalesced).toBe(false)
    const recorded = recordForkLeakCheckpoint(
      (counts) => [counts.get('TCPSocketWrap')],
      result,
      'growth.test.mts',
    )
    expect(recorded).toEqual([6])
  })

  it('preserves a stable but nonzero ConnectWrap instead of coalescing it', async () => {
    let turns = 0
    const tcpSocket = {}
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => ['ConnectWrap', 'TCPSocketWrap'],
      readPoolMetrics: () => poolMetrics(1, 0),
      readPoolSocketHandles: () => socketHandles([tcpSocket], [tcpSocket]),
      stableObservations: 2,
      maxTurns: 100,
      waitForTurn: async () => {
        turns += 1
      },
    })

    expect(turns).toBe(2)
    expect(result.coalesced).toBe(false)
    expect(result.snapshot).toMatchObject({ connectWraps: 1, tcpSockets: 1 })
    expect(result.observations).toHaveLength(4)
  })

  it('records one actual resource snapshot for a completed test', () => {
    const makeSnapshot = (
      tcpSockets: number,
      extraResources: readonly string[] = [],
    ): ForkLeakHandshakeSnapshot => ({
      connectWraps: 0,
      tcpSockets,
      resources: [...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'), ...extraResources],
      tcpSocketHandles: new Set(),
      poolMetrics: null,
    })
    const settlement: ForkLeakHandshakeSettlement = {
      snapshot: makeSnapshot(8),
      detectorSnapshot: makeSnapshot(4),
      observations: [makeSnapshot(2, ['PipeWrap', 'PipeWrap']), makeSnapshot(4), makeSnapshot(8)],
      coalesced: false,
    }
    let recordCalls = 0

    const result = recordForkLeakCheckpoint(
      (counts, testFile) => {
        recordCalls += 1
        return [{ counts, testFile }]
      },
      settlement,
      'one.test.mts',
    )

    expect(recordCalls).toBe(1)
    expect(result).toEqual([{ counts: new Map([['TCPSocketWrap', 4]]), testFile: 'one.test.mts' }])

    const settledResult = recordForkLeakCheckpoint(
      (counts, testFile) => {
        recordCalls += 1
        return [{ counts, testFile }]
      },
      { ...settlement, coalesced: true },
      'settled.test.mts',
    )
    expect(recordCalls).toBe(2)
    expect(settledResult).toEqual([
      { counts: new Map([['TCPSocketWrap', 8]]), testFile: 'settled.test.mts' },
    ])
  })

  it('returns the latest raw checkpoint when a pool transition reaches the turn cap', async () => {
    let tcpSockets = 1
    let poolTotal = 1
    const tcpHandles = [{}]
    const ownedHandles = [...tcpHandles]
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        'ConnectWrap',
      ],
      readPoolMetrics: () => poolMetrics(poolTotal, 0),
      readPoolSocketHandles: () => socketHandles(tcpHandles, ownedHandles),
      maxTurns: 3,
      waitForTurn: async () => {
        tcpSockets += 1
        poolTotal += 1
        const socketHandle = {}
        tcpHandles.push(socketHandle)
        ownedHandles.push(socketHandle)
      },
    })

    expect(result.coalesced).toBe(false)
    expect(result.snapshot.tcpSockets).toBe(4)
    expect(
      recordForkLeakCheckpoint((counts) => [counts.get('TCPSocketWrap')], result, 'cap.test.mts'),
    ).toEqual([4])
    expect(result.observations).toHaveLength(5)
  })

  it('returns the initial snapshot when pool metrics are unavailable', async () => {
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [],
      readPoolMetrics: () => null,
      readPoolSocketHandles: () => null,
      waitForTurn: async () => {
        throw new Error('unexpected turn')
      },
    })

    expect(result.coalesced).toBe(false)
    expect(result.observations).toHaveLength(1)
    expect(result.snapshot.tcpSockets).toBe(0)
  })

  it('treats a socket owned on an earlier turn as pool-owned after it leaves the owned set', async () => {
    const first = {}
    const extra = {}
    let turns = 0
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => (turns === 0 ? ['TCPSocketWrap'] : ['TCPSocketWrap', 'TCPSocketWrap']),
      readPoolMetrics: () => (turns === 0 ? poolMetrics(1, 0) : poolMetrics(2, 2)),
      readPoolSocketHandles: () => {
        if (turns === 0) return socketHandles([first], [first])
        if (turns === 1) return socketHandles([first, extra], [first, extra])
        return socketHandles([first, extra], [first])
      },
      stableObservations: 1,
      maxTurns: 4,
      waitForTurn: async () => {
        turns += 1
      },
    })

    expect(result.coalesced).toBe(true)
  })

  it('stops when a later pool or handle sample disappears', async () => {
    let metricReads = 0
    const missingMetrics = await waitForForkLeakHandshakeSettle({
      readResources: () => ['TCPSocketWrap'],
      readPoolMetrics: () => {
        metricReads += 1
        return metricReads === 1 ? poolMetrics(1, 1) : null
      },
      readPoolSocketHandles: () => socketHandles([], []),
      waitForTurn: async () => {
        throw new Error('unexpected turn')
      },
    })
    expect(missingMetrics.observations).toHaveLength(2)

    let handleReads = 0
    const missingInitialHandles = await waitForForkLeakHandshakeSettle({
      readResources: () => ['TCPSocketWrap'],
      readPoolMetrics: () => poolMetrics(1, 1),
      readPoolSocketHandles: () => {
        handleReads += 1
        return handleReads === 3 ? socketHandles([], []) : null
      },
      waitForTurn: async () => {
        throw new Error('unexpected turn')
      },
    })
    expect(missingInitialHandles.coalesced).toBe(false)

    handleReads = 0
    const missingProbeHandles = await waitForForkLeakHandshakeSettle({
      readResources: () => ['TCPSocketWrap'],
      readPoolMetrics: () => poolMetrics(1, 1),
      readPoolSocketHandles: () => {
        handleReads += 1
        return handleReads >= 3 ? null : socketHandles([], [])
      },
      waitForTurn: async () => {
        throw new Error('unexpected turn')
      },
    })
    expect(missingProbeHandles.observations).toHaveLength(2)
  })

  it('returns a settled idle probe and records an unowned socket seen before the first turn', async () => {
    let turns = 0
    const settled = await waitForForkLeakHandshakeSettle({
      readResources: () => ['TCPSocketWrap'],
      readPoolMetrics: () => poolMetrics(2, 2),
      readPoolSocketHandles: () => socketHandles([], []),
      waitForTurn: async () => {
        turns += 1
      },
    })
    expect(turns).toBe(0)
    expect(settled.snapshot).toMatchObject({ connectWraps: 0, tcpSockets: 1 })
    expect(settled.coalesced).toBe(false)

    const first = {}
    const extra = {}
    let metricReads = 0
    let handleReads = 0
    const pending = await waitForForkLeakHandshakeSettle({
      readResources: () => ['TCPSocketWrap', 'TCPSocketWrap'],
      readPoolMetrics: () => {
        metricReads += 1
        return metricReads === 1 ? poolMetrics(1, 1) : poolMetrics(2, 2)
      },
      readPoolSocketHandles: () => {
        handleReads += 1
        if (handleReads <= 2) return socketHandles([first], [first])
        return socketHandles([first, extra], [first])
      },
      stableObservations: 1,
      maxTurns: 1,
      waitForTurn: async () => {},
    })
    expect(pending.observations.length).toBeGreaterThan(1)
  })

  it('flags the unsmoothed merge-queue ramp and absorbs the same sockets as one settled jump', () => {
    expect(
      recordAll(createForkLeakDetector(), [0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 5, 5, 5, 6, 7, 8])[0],
    ).toMatchObject({
      baseline: 0,
      current: 8,
      streak: 5,
      growthCheckpoints: 3,
      suspectedGrowth: { previous: 4, current: 5, delta: 1 },
    })
    expect(recordAll(createForkLeakDetector(), [0, 0, 0, 0, 0, 8, 8, 8, 8, 8, 8])).toEqual([])
  })
})
