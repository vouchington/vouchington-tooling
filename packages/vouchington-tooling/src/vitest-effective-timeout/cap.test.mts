import { describe, expect, it } from 'vitest'
import {
  assertEffectiveTimeoutCap,
  DEFAULT_EFFECTIVE_TIMEOUT_MS,
  DEFAULT_EFFECTIVE_TIMEOUT_PLUGIN,
  effectiveTimeoutCap,
} from './cap.mts'

type Configure = (context: {
  project: { config: { name?: string; testTimeout?: number; hookTimeout?: number } }
}) => void

function configure(maxTimeoutMs?: number): Configure {
  const plugin = effectiveTimeoutCap(maxTimeoutMs === undefined ? {} : { maxTimeoutMs })
  return (plugin as unknown as { configureVitest: Configure }).configureVitest
}

describe('effectiveTimeoutCap', () => {
  it('uses the generic plugin name and the default 30000ms cap', () => {
    expect(effectiveTimeoutCap().name).toBe(DEFAULT_EFFECTIVE_TIMEOUT_PLUGIN)
    expect(() =>
      configure()({ project: { config: { name: 'unit', testTimeout: 30_000, hookTimeout: 1 } } }),
    ).not.toThrow()
  })

  it('rejects a non-finite, non-positive, or above-cap timeout', () => {
    const check = configure(10_000)
    expect(() =>
      check({ project: { config: { name: 'unit', testTimeout: 10_001, hookTimeout: 1 } } }),
    ).toThrow(/Project unit: effective testTimeout must be finite, positive, and at most 10000ms/)
    expect(() =>
      check({ project: { config: { name: 'unit', testTimeout: 1, hookTimeout: 0 } } }),
    ).toThrow(/effective hookTimeout/)
    expect(() =>
      check({ project: { config: { name: 'unit', testTimeout: Infinity, hookTimeout: 1 } } }),
    ).toThrow(/received Infinity/)
    expect(assertEffectiveTimeoutCap(DEFAULT_EFFECTIVE_TIMEOUT_MS)).toBe(
      DEFAULT_EFFECTIVE_TIMEOUT_MS,
    )
    expect(() => assertEffectiveTimeoutCap(4_999)).toThrow(/at least 5000ms/)
  })
})
