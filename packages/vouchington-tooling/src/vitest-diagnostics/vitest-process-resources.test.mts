// Regression coverage for the fields that guard against a misread: heapUsedMB/heapTotalMB
// ("~97% occupancy") is not measured against a limit, since V8 steady-state keeps heapTotal near
// heapUsed by design. formatProcessResources() therefore also reports
// heapLimitMB/heapPctOfLimit from v8.getHeapStatistics().heap_size_limit — the actual ceiling —
// and this file is the first dedicated spec for that computation.
import { getHeapStatistics } from 'node:v8'
import { describe, expect, it, vi } from 'vitest'
import {
  formatActiveResources,
  formatBytes,
  formatPercent,
  formatProcessResources,
} from './vitest-process-resources.mts'

describe('formatBytes', () => {
  it('converts a byte count to a fixed-one-decimal MB string', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0')
    expect(formatBytes(1536 * 1024)).toBe('1.5')
    expect(formatBytes(0)).toBe('0.0')
  })
})

describe('formatPercent', () => {
  it('computes numerator/denominator as a one-decimal percentage', () => {
    expect(formatPercent(50, 200)).toBe('25.0')
    expect(formatPercent(1, 3)).toBe('33.3')
  })

  it('returns 0.0 for a non-positive denominator instead of dividing by zero', () => {
    expect(formatPercent(50, 0)).toBe('0.0')
    expect(formatPercent(50, -10)).toBe('0.0')
  })
})

describe('formatActiveResources', () => {
  it('lists active resources and reports an empty or missing snapshot', () => {
    const resources = vi.spyOn(process, 'getActiveResourcesInfo')
    resources.mockReturnValue(['TCPSocketWrap', 'PipeWrap'])
    expect(formatActiveResources()).toBe('TCPSocketWrap, PipeWrap')
    resources.mockReturnValue([])
    expect(formatActiveResources()).toBe('(none)')
    resources.mockReturnValue(undefined as unknown as string[])
    expect(formatActiveResources()).toBe('(none)')
    resources.mockRestore()

    const descriptor = Object.getOwnPropertyDescriptor(process, 'getActiveResourcesInfo')
    Object.defineProperty(process, 'getActiveResourcesInfo', {
      configurable: true,
      value: undefined,
    })
    try {
      expect(formatActiveResources()).toBe('(none)')
    } finally {
      if (descriptor) Object.defineProperty(process, 'getActiveResourcesInfo', descriptor)
    }
  })
})

describe('formatProcessResources', () => {
  it('reports every field the teardown-overrun diagnostics depend on', () => {
    const line = formatProcessResources()

    // An absent field here would silently blank a column in [vitest-teardown-overrun] output
    // instead of failing loudly — so presence, not just parseability, is the assertion.
    for (const field of [
      'pid',
      'rssMB',
      'heapUsedMB',
      'heapTotalMB',
      'heapLimitMB',
      'heapPctOfLimit',
      'userCpuMs',
      'systemCpuMs',
    ]) {
      expect(line).toMatch(new RegExp(`(?:^|\\s)${field}=-?\\d+(?:\\.\\d+)?(?:\\s|$)`))
    }
  })

  it('sources heapLimitMB from v8 heap_size_limit, not heapTotalMB', () => {
    const line = formatProcessResources()
    const fields = Object.fromEntries(
      [...line.matchAll(/(\w+)=(-?\d+(?:\.\d+)?)/g)].map(([, key, value]) => [key, Number(value)]),
    )

    // heap_size_limit is V8's fixed ceiling (well over 1000 MB on every runtime this repo
    // targets) — strictly above heapTotalMB, which is steady-state bookkeeping that sits close
    // to heapUsedMB by design. Equal or smaller here would mean heapLimitMB regressed back to
    // reading heapTotal, reproducing the issue's original false "near the limit" premise.
    const heapLimitBytes = getHeapStatistics().heap_size_limit
    expect(fields.heapLimitMB).toBeCloseTo(heapLimitBytes / (1024 * 1024), 1)
    expect(fields.heapLimitMB).toBeGreaterThan(fields.heapTotalMB)
  })

  it('computes heapPctOfLimit against heapLimitMB, not heapTotalMB', () => {
    const line = formatProcessResources()
    const fields = Object.fromEntries(
      [...line.matchAll(/(\w+)=(-?\d+(?:\.\d+)?)/g)].map(([, key, value]) => [key, Number(value)]),
    )

    // Recomputed the same way formatPercent does, from the line's own heapUsedMB/heapLimitMB —
    // this is the assertion that would have caught the issue's misreading: a wrong wiring back to
    // heapTotalMB would produce a percentage close to 100, not this one.
    const expectedPct = Number(((fields.heapUsedMB / fields.heapLimitMB) * 100).toFixed(1))
    // The displayed MB values have already been rounded independently, so recomputing from them
    // can differ by one tenth from the percentage calculated from the original byte values.
    expect(Math.abs(fields.heapPctOfLimit - expectedPct)).toBeLessThanOrEqual(0.11)
    expect(fields.heapPctOfLimit).toBeLessThan(100)
  })
})
