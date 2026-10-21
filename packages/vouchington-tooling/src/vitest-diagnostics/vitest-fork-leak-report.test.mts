import { describe, expect, it } from 'vitest'
import {
  formatForkLeakDiagnostics,
  getRegisteredPoolMetrics,
  getRegisteredPoolSocketHandles,
} from './vitest-fork-leak-diagnostics.mts'
import { getForkLeakDetector } from './vitest-fork-leak-detection.mts'

describe('getForkLeakDetector', () => {
  it('returns the same detector instance on repeated calls within a process', () => {
    const first = getForkLeakDetector()
    const second = getForkLeakDetector()

    expect(second).toBe(first)
  })
})

describe('formatForkLeakDiagnostics', () => {
  it('renders the verdict, tracked counts, and unavailable pool context', () => {
    const counts = new Map<string, number>([
      ['PipeWrap', 8],
      ['TCPSocketWrap', 14],
      ['Timeout', 1],
    ])

    expect(
      formatForkLeakDiagnostics(
        {
          type: 'TCPSocketWrap',
          baseline: 5,
          current: 14,
          streak: 5,
          growthCheckpoints: 4,
          requiredGrowthCheckpoints: 4,
          detectedInFile: 'bystander.test.mts',
          suspectedGrowth: {
            testFile: 'source.test.mts',
            previous: 8,
            current: 14,
            delta: 6,
          },
        },
        counts,
      ),
    ).toBe(
      [
        '[vitest-fork-leak]',
        'type: TCPSocketWrap',
        'baseline: 5',
        'current: 14 (+9)',
        'candidate evidence span: 5',
        'candidate growth evidence: 4 (required: 4)',
        'confirmed by continuation in file: bystander.test.mts',
        'suspected growth file: source.test.mts',
        'largest growth step: 8 -> 14 (+6)',
        'tracked resource counts: PipeWrap=8 TCPSocketWrap=14 Timeout=1',
        'pool metrics: unavailable (pools not initialized)',
      ].join('\n'),
    )
  })

  it('formats a missing growth step and registered pool metrics in label order', () => {
    const metricsKey = Symbol.for('vitest-fork-leak-pool-metrics')
    const socketsKey = Symbol.for('vitest-fork-leak-pool-socket-handles')
    const sockets = { active: new Set(), owned: new Set() }
    ;(globalThis as typeof globalThis & Record<symbol, unknown>)[metricsKey] = () => ({
      write: { total: 1, idle: 0, nonIdleOrConnecting: 1, waiting: 3 },
      read: { total: 2, idle: 1, nonIdleOrConnecting: 1, waiting: 0 },
    })
    ;(globalThis as typeof globalThis & Record<symbol, unknown>)[socketsKey] = () => sockets

    try {
      const report = formatForkLeakDiagnostics(
        {
          type: 'TCPSocketWrap',
          baseline: 1,
          current: 2,
          streak: 1,
          growthCheckpoints: 0,
          requiredGrowthCheckpoints: 4,
          detectedInFile: null,
          suspectedGrowth: null,
        },
        new Map(),
        getRegisteredPoolMetrics(),
      )

      expect(getRegisteredPoolSocketHandles()).toBe(sockets)
      expect(report).toContain('confirmed by continuation in file: unknown')
      expect(report).toContain('largest growth step: unknown')
      expect(report.indexOf('read(total=2')).toBeLessThan(report.indexOf('write(total=1'))
    } finally {
      delete (globalThis as typeof globalThis & Record<symbol, unknown>)[metricsKey]
      delete (globalThis as typeof globalThis & Record<symbol, unknown>)[socketsKey]
    }
    expect(getRegisteredPoolMetrics()).toBeNull()
    expect(getRegisteredPoolSocketHandles()).toBeNull()
  })
})
