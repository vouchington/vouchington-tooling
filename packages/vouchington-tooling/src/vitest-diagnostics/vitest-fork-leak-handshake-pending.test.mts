import { describe, expect, it } from 'vitest'
import type { PoolMetrics, PoolSocketHandles } from './vitest-fork-leak-handshake-samples.mts'
import {
  recordForkLeakCheckpoint,
  waitForForkLeakHandshakeSettle,
} from './vitest-fork-leak-handshake.mts'

function poolMetrics(total: number, idle = total): PoolMetrics {
  const metric = { total, idle, nonIdleOrConnecting: total - idle, waiting: 0 }
  const empty = { total: 0, idle: 0, nonIdleOrConnecting: 0, waiting: 0 }
  return { write: metric, read: empty, advisoryLock: empty, jobSerialization: empty }
}

function socketHandles(active: readonly object[], owned: readonly object[]): PoolSocketHandles {
  return { active: new Set(active), owned: new Set(owned) }
}

describe('pending pool socket handshake', () => {
  it('preserves growth while a pool socket is still pending and unidentifiable', async () => {
    let tcpSockets = 4
    let poolTotal = 4
    const tcpHandles = Array.from({ length: tcpSockets }, () => ({}))
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        'ConnectWrap',
      ],
      readPoolMetrics: () => poolMetrics(poolTotal, 3),
      readPoolSocketHandles: () => socketHandles(tcpHandles, []),
      maxTurns: 4,
      waitForTurn: async () => {
        if (tcpSockets === 4) {
          tcpSockets += 1
          poolTotal += 1
          tcpHandles.push({})
        }
      },
    })

    expect(result.coalesced).toBe(false)
    expect(result.observations.map((observation) => observation.tcpSockets)).toEqual([
      4, 4, 5, 5, 5, 5,
    ])
    expect(result.detectorSnapshot.tcpSockets).toBe(5)

    let repeatedTurns = 0
    let repeatedTcpSockets = 4
    let repeatedPoolTotal = 4
    const repeated = await waitForForkLeakHandshakeSettle({
      readResources: () =>
        Array.from({ length: repeatedTcpSockets }, () => 'TCPSocketWrap').concat('ConnectWrap'),
      readPoolMetrics: () => poolMetrics(repeatedPoolTotal, 3),
      readPoolSocketHandles: () => socketHandles(tcpHandles.slice(0, repeatedTcpSockets), []),
      maxTurns: 100,
      waitForTurn: async () => {
        repeatedTurns += 1
        if (repeatedTurns === 1) {
          repeatedTcpSockets = 5
          repeatedPoolTotal = 5
        }
      },
    })
    expect(repeated.coalesced).toBe(false)
    expect(repeatedTurns).toBe(3)
  })

  it('waits for a pending pool handle to become owned before coalescing', async () => {
    let turns = 0
    let tcpSockets = 4
    let poolTotal = 4
    let connectWraps = 1
    const tcpHandles = Array.from({ length: 4 }, () => ({}))
    const ownedHandles = [...tcpHandles]
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
        ...Array.from({ length: connectWraps }, () => 'ConnectWrap'),
      ],
      readPoolMetrics: () => poolMetrics(poolTotal, 3),
      readPoolSocketHandles: () => socketHandles(tcpHandles, ownedHandles),
      maxTurns: 20,
      waitForTurn: async () => {
        turns += 1
        if (turns === 1) {
          tcpSockets = 5
          poolTotal = 5
          tcpHandles.push({})
        } else if (turns === 5) {
          ownedHandles.push(tcpHandles[4]!)
          connectWraps = 0
        }
      },
    })

    expect(turns).toBe(7)
    expect(result.coalesced).toBe(true)
    expect(result.observations[2]?.tcpSocketHandles.has(tcpHandles[4]!)).toBe(true)
    expect(
      recordForkLeakCheckpoint((counts) => [counts.get('TCPSocketWrap')], result, 'pool.test.mts'),
    ).toEqual([5])
  })

  it('waits for an initially pending pool handle after ConnectWrap disappears', async () => {
    const pendingHandle = {}
    const ownedHandles: object[] = []
    let turns = 0
    let connectWraps = 1
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        'TCPSocketWrap',
        ...Array.from({ length: connectWraps }, () => 'ConnectWrap'),
      ],
      readPoolMetrics: () => poolMetrics(1, 0),
      readPoolSocketHandles: () => socketHandles([pendingHandle], ownedHandles),
      maxTurns: 12,
      waitForTurn: async () => {
        turns += 1
        if (turns === 1) connectWraps = 0
        if (turns === 4) ownedHandles.push(pendingHandle)
      },
    })

    expect(turns).toBe(5)
    expect(result.coalesced).toBe(true)
    expect(result.snapshot.tcpSocketHandles.has(pendingHandle)).toBe(true)
  })

  it('waits for an initially unowned handle after ConnectWrap has already disappeared', async () => {
    const pendingHandle = {}
    const ownedHandles: object[] = []
    let turns = 0
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => ['TCPSocketWrap'],
      readPoolMetrics: () => poolMetrics(1, 0),
      readPoolSocketHandles: () => socketHandles([pendingHandle], ownedHandles),
      maxTurns: 12,
      waitForTurn: async () => {
        turns += 1
        if (turns === 4) ownedHandles.push(pendingHandle)
      },
    })

    expect(turns).toBe(4)
    expect(result.coalesced).toBe(true)
    expect(result.snapshot.tcpSocketHandles.has(pendingHandle)).toBe(true)
  })

  it('waits for multiple initially pending pool handles to become owned', async () => {
    const pendingHandles = [{}, {}]
    const ownedHandles: object[] = []
    let turns = 0
    let connectWraps = 2
    const result = await waitForForkLeakHandshakeSettle({
      readResources: () => [
        'TCPSocketWrap',
        'TCPSocketWrap',
        ...Array.from({ length: connectWraps }, () => 'ConnectWrap'),
      ],
      readPoolMetrics: () => poolMetrics(2, 0),
      readPoolSocketHandles: () => socketHandles(pendingHandles, ownedHandles),
      maxTurns: 12,
      waitForTurn: async () => {
        turns += 1
        if (turns === 1) ownedHandles.push(pendingHandles[0]!)
        if (turns === 2) {
          ownedHandles.push(pendingHandles[1]!)
          connectWraps = 0
        }
      },
    })

    expect(turns).toBe(4)
    expect(result.coalesced).toBe(true)
    expect(pendingHandles.every((handle) => result.snapshot.tcpSocketHandles.has(handle))).toBe(
      true,
    )
  })

  for (const providerLost of [false, true]) {
    it(`records earlier unowned growth when it vanishes${providerLost ? ' with provider loss' : ''}`, async () => {
      let turns = 0
      let tcpSockets = 4
      let poolTotal = 4
      const tcpHandles = Array.from({ length: 4 }, () => ({}))
      const ownedHandles = [...tcpHandles]
      const result = await waitForForkLeakHandshakeSettle({
        readResources: () => [
          ...Array.from({ length: tcpSockets }, () => 'TCPSocketWrap'),
          ...(turns < 3 ? ['ConnectWrap'] : []),
        ],
        readPoolMetrics: () => poolMetrics(poolTotal, 3),
        readPoolSocketHandles: () =>
          providerLost && turns >= 3 ? null : socketHandles(tcpHandles, ownedHandles),
        waitForTurn: async () => {
          turns += 1
          if (turns === 1) {
            tcpSockets = 5
            poolTotal = 5
            const poolHandle = {}
            tcpHandles.push(poolHandle)
            ownedHandles.push(poolHandle)
          } else if (turns === 2) {
            tcpSockets = 6
            tcpHandles.push({})
          } else if (turns === 3) {
            tcpSockets = 5
            tcpHandles.pop()
          }
        },
      })

      expect(result.coalesced).toBe(false)
      expect(result.snapshot.tcpSockets).toBe(5)
      expect(
        recordForkLeakCheckpoint(
          (counts) => [counts.get('TCPSocketWrap')],
          result,
          'loss.test.mts',
        ),
      ).toEqual([6])
    })
  }
})
