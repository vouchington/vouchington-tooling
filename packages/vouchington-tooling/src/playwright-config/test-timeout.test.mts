import { describe, expect, it, vi } from 'vitest'
import {
  createPlaywrightTimeoutGuard,
  DEFAULT_PLAYWRIGHT_TEST_TIMEOUT_MS,
  DEFAULT_PLAYWRIGHT_TIMEOUT_GUARD_FIXTURE,
} from './index.mts'
import type { FullConfig, PlaywrightTestConfig, TestInfo } from '@playwright/test'

const invalid = [0, -1, 30_001, Number.POSITIVE_INFINITY, Number.NaN]

describe('createPlaywrightTimeoutGuard options', () => {
  it('defaults to a 30,000 ms cap, neutral fixture name, and banOverrides off', () => {
    const guard = createPlaywrightTimeoutGuard()
    expect(guard.maxTimeoutMs).toBe(DEFAULT_PLAYWRIGHT_TEST_TIMEOUT_MS)
    expect(guard.fixtureName).toBe(DEFAULT_PLAYWRIGHT_TIMEOUT_GUARD_FIXTURE)
    expect(guard.banOverrides).toBe(false)
  })

  it('rejects unnamed project timeouts above the cap with an unnamed label', () => {
    const { validateConfigTimeouts } = createPlaywrightTimeoutGuard()
    expect(() => validateConfigTimeouts({ projects: [{ timeout: 30_001 }] })).toThrow(
      'Playwright project <unnamed> timeout must be a positive finite number at most 30,000 ms',
    )
  })

  it('forbids runtime info.setTimeout calls at any value when banOverrides is true', async () => {
    const guard = createPlaywrightTimeoutGuard({ maxTimeoutMs: 12_500, banOverrides: true })
    expect(guard.banOverrides).toBe(true)
    const original = vi.fn<(timeout: number) => void>()
    const info = {
      timeout: 12_500,
      setTimeout: original,
      project: { timeout: 10_000 },
    } as unknown as TestInfo
    const use = vi.fn<() => Promise<void>>()
    await guard.timeoutFixture({}, use, info)
    expect(() => info.setTimeout(5_000)).toThrow(
      'Playwright runtime test timeout overrides are forbidden by the 12,500 ms test cap',
    )
    expect(original).not.toHaveBeenCalled()
    info.setTimeout(10_000)
    expect(original).toHaveBeenCalledExactlyOnceWith(10_000)
  })

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('rejects cap %s', (cap) => {
    expect(() => createPlaywrightTimeoutGuard({ maxTimeoutMs: cap })).toThrow(RangeError)
  })

  it('formats the configured cap in every message', () => {
    const guard = createPlaywrightTimeoutGuard({ maxTimeoutMs: 12_500 })
    expect(() => guard.testTimeout(12_501, 'x')).toThrow(
      'x must be a positive finite number at most 12,500 ms',
    )
    expect(guard.testTimeout(12_500, 'x')).toBe(12_500)
    expect(() =>
      guard.timeoutFixture({}, vi.fn(), {
        timeout: 1,
        setTimeout() {},
        slow() {},
      } as unknown as TestInfo),
    ).not.toThrow()
  })

  it('keeps separate guards independent', () => {
    const small = createPlaywrightTimeoutGuard({ maxTimeoutMs: 1_000 })
    const large = createPlaywrightTimeoutGuard({ maxTimeoutMs: 2_000 })
    expect(() => small.testTimeout(1_500, 'x')).toThrow(RangeError)
    expect(large.testTimeout(1_500, 'x')).toBe(1_500)
  })
})

describe('config validation', () => {
  const { validateConfigTimeouts, assertResolvedTimeouts } = createPlaywrightTimeoutGuard()

  it.each(invalid)('rejects invalid test timeout %s', (timeout) => {
    expect(() => validateConfigTimeouts({ timeout })).toThrow(RangeError)
  })

  it.each(invalid)('rejects invalid project timeout %s', (timeout) => {
    expect(() => validateConfigTimeouts({ projects: [{ name: 'chromium', timeout }] })).toThrow(
      RangeError,
    )
  })

  it('accepts timeouts at the ceiling and projects without one', () => {
    const config: PlaywrightTestConfig = {
      timeout: 30_000,
      projects: [{ name: 'a', timeout: 30_000 }, { name: 'b' }],
    }
    expect(validateConfigTimeouts(config)).toBe(config)
    expect(validateConfigTimeouts({})).toEqual({})
  })

  it.each(invalid)('rejects resolved project timeout %s', (timeout) => {
    const config = { projects: [{ name: 'chromium', timeout }] } as unknown as FullConfig
    expect(() => assertResolvedTimeouts(config)).toThrow(RangeError)
  })

  it('accepts a resolved project at the ceiling', () => {
    const config = { projects: [{ name: 'chromium', timeout: 30_000 }] } as unknown as FullConfig
    expect(() => assertResolvedTimeouts(config)).not.toThrow()
  })
})

describe('hook timeout protection', () => {
  const guard = createPlaywrightTimeoutGuard()

  it.each(invalid)('rejects effective timeout %s before the test body', async (timeout) => {
    const use = vi.fn<() => Promise<void>>()
    await expect(guard.timeoutFixture({}, use, { timeout } as TestInfo)).rejects.toThrow(RangeError)
    expect(use).not.toHaveBeenCalled()
  })

  it('protects the same info once and caps later setTimeout and slow calls', async () => {
    const original = vi.fn<(timeout: number) => void>()
    const info = {
      timeout: 30_000,
      setTimeout: original,
      project: { timeout: 30_000 },
    } as unknown as TestInfo
    const use = vi.fn<() => Promise<void>>()
    await guard.timeoutFixture({}, use, info)
    const setter: unknown = Reflect.get(info, 'setTimeout')
    await guard.timeoutFixture({}, use, info)
    expect(Reflect.get(info, 'setTimeout')).toBe(setter)
    expect(use).toHaveBeenCalledTimes(2)
    info.setTimeout(25_000)
    expect(original).toHaveBeenCalledExactlyOnceWith(25_000)
    expect(() => info.setTimeout(30_001)).toThrow(RangeError)
    expect(() => info.slow()).toThrow('slow modifiers are forbidden by the 30,000 ms test cap')
  })
})
