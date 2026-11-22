import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createPlaywrightTimeoutGuard } from './index.mts'
import type { PlaywrightTimeoutGuardOptions } from './index.mts'
import type { test as PlaywrightBase } from '@playwright/test'

// A minimal stand-in for Playwright's TestType. The runtime tests cover the real runner.
function fakeBase() {
  const calls = {
    extend: vi.fn<(fixtures: object) => unknown>(),
    use: vi.fn<(fixtures: object) => void>(),
    setTimeout: vi.fn<(timeout: number) => void>(),
    configure: vi.fn<(options: object) => void>(),
  }
  const make = () => {
    const base = {
      beforeAll: () => {},
      afterAll: () => {},
      info: () => ({}),
      setTimeout: calls.setTimeout,
      slow: () => {},
      use: calls.use,
      describe: { configure: calls.configure },
      extend: (fixtures: object) => {
        calls.extend(fixtures)
        return make()
      },
    }
    return base
  }
  return { calls, base: make() as unknown as typeof PlaywrightBase }
}

describe('guardTestTimeouts', () => {
  it('adds the named automatic fixture and forwards legal calls', () => {
    const { base, calls } = fakeBase()
    const guard = createPlaywrightTimeoutGuard({ fixtureName: 'myGuard' })
    const test = guard.guardTestTimeouts(base)
    const added = calls.extend.mock.calls[0]?.[0] as Record<string, unknown[]>
    expect(added['myGuard']?.[0]).toBe(guard.timeoutFixture)
    expect(added['myGuard']?.[1]).toEqual({ auto: true })

    test.setTimeout(30_000)
    expect(calls.setTimeout).toHaveBeenCalledExactlyOnceWith(30_000)
    expect(() => test.setTimeout(30_001)).toThrow(RangeError)
    expect(() => test.slow()).toThrow('slow modifiers are forbidden by the 30,000 ms test cap')

    test.describe.configure({ timeout: 5_000 })
    expect(calls.configure).toHaveBeenCalledOnce()
    expect(() => test.describe.configure({ timeout: 40_000 })).toThrow(RangeError)

    test.use({ data: 1 } as never)
    expect(calls.use).toHaveBeenCalledOnce()
    expect(() => test.use({ myGuard: undefined })).toThrow(
      'timeout guard overrides are forbidden by the 30,000 ms test cap',
    )

    const child = test.extend({ extra: 1 } as never)
    expect(() => child.setTimeout(0)).toThrow(RangeError)
    expect(() => test.extend({ myGuard: undefined })).toThrow(RangeError)
  })

  it('types the guarded test with the literal fixture name', () => {
    const { base } = fakeBase()
    const guard = createPlaywrightTimeoutGuard({ fixtureName: 'myGuard' })
    expectTypeOf(guard.fixtureName).toEqualTypeOf<'myGuard'>()
    const test = guard.guardTestTimeouts(base)
    type UseFixtures = Parameters<typeof test.use>[0]
    expectTypeOf<UseFixtures>().toHaveProperty('myGuard')
    expectTypeOf<UseFixtures>().toHaveProperty('page')
    // @ts-expect-error -- only the configured name becomes a fixture
    expectTypeOf<UseFixtures>().toHaveProperty('otherGuard')
    expectTypeOf(
      createPlaywrightTimeoutGuard().fixtureName,
    ).toEqualTypeOf<'playwrightTimeoutGuard'>()
    const omitted: PlaywrightTimeoutGuardOptions<'myGuard'> = {}
    // @ts-expect-error -- a custom name type needs the name itself, or the guard would mistype it
    createPlaywrightTimeoutGuard(omitted)
  })

  it('uses the configured cap and the default fixture name', () => {
    const { base, calls } = fakeBase()
    const test = createPlaywrightTimeoutGuard({ maxTimeoutMs: 10_000 }).guardTestTimeouts(base)
    expect(Object.keys(calls.extend.mock.calls[0]?.[0] ?? {})).toEqual(['playwrightTimeoutGuard'])
    expect(() => test.setTimeout(10_001)).toThrow('at most 10,000 ms')
  })

  it('reuses a validated snapshot for the same fixtures and rejects changed ones', () => {
    const { base } = fakeBase()
    const test = createPlaywrightTimeoutGuard().guardTestTimeouts(base)
    const shared = { sample: [async () => {}, { timeout: 30_000 }] } as never
    test.extend(shared)
    test.extend(shared)
    ;(shared as { sample: [unknown, { timeout: number }] }).sample[1].timeout = 30_001
    expect(() => test.extend(shared)).toThrow(RangeError)
  })

  it('rejects over-cap fixture tuple timeouts at collection', () => {
    const { base } = fakeBase()
    const test = createPlaywrightTimeoutGuard().guardTestTimeouts(base)
    expect(() => test.extend({ sample: [async () => {}, { timeout: 30_001 }] } as never)).toThrow(
      RangeError,
    )
    expect(() => test.extend({ sample: [async () => {}, { timeout: 1 }] } as never)).not.toThrow()
  })
})
