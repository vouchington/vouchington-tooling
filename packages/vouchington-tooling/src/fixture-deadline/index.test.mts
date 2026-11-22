import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixtureDeadline, DEFAULT_FIXTURE_DEADLINE_MS } from './index.mts'

afterEach(() => {
  vi.restoreAllMocks()
})

function fakeClock(start: bigint) {
  let now = start
  vi.spyOn(process.hrtime, 'bigint').mockImplementation(() => now)
  return (milliseconds: bigint) => {
    now += milliseconds * 1_000_000n
  }
}

describe('createFixtureDeadline', () => {
  it('counts down from the default budget', () => {
    const advance = fakeClock(10n)
    const remaining = createFixtureDeadline()
    expect(DEFAULT_FIXTURE_DEADLINE_MS).toBe(4000)
    expect(remaining()).toBe(4000)
    advance(1500n)
    expect(remaining()).toBe(2500)
  })

  it('honours a custom budget', () => {
    const advance = fakeClock(0n)
    const remaining = createFixtureDeadline(250)
    expect(remaining()).toBe(250)
    advance(100n)
    expect(remaining()).toBe(150)
  })

  it('throws once the budget is exhausted', () => {
    const advance = fakeClock(0n)
    const remaining = createFixtureDeadline(100)
    advance(100n)
    expect(() => remaining()).toThrow('Analyzer fixture case deadline exhausted')
  })
})
