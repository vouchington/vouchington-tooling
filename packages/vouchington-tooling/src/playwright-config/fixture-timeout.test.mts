import { describe, expect, it } from 'vitest'
import { snapshotFixtureTimeouts, snapshotOptionsTimeout } from './fixture-timeout.mts'
import type { FixtureTimeoutGuard } from './fixture-timeout.mts'

const validate: FixtureTimeoutGuard['validate'] = (timeout, label) => {
  if (typeof timeout !== 'number' || timeout <= 0 || timeout > 100) {
    throw new RangeError(`${label} must be at most 100`)
  }
  return timeout
}
const guard: FixtureTimeoutGuard = { validate, fixtureName: 'guardFixture', capText: '100 ms' }
const noop = () => {}

describe('snapshotOptionsTimeout', () => {
  it('captures the timeout once and forwards other keys', () => {
    let reads = 0
    const options = {
      get timeout() {
        reads++
        return reads === 1 ? 50 : 500
      },
      scope: 'test',
    }
    const view = snapshotOptionsTimeout(options, validate, 'x') as typeof options
    expect(view.timeout).toBe(50)
    expect(view.timeout).toBe(50)
    expect(view.scope).toBe('test')
    expect(reads).toBe(1)
  })

  it('leaves an undeclared timeout undefined and rejects an invalid one', () => {
    expect((snapshotOptionsTimeout({}, validate, 'x') as { timeout?: number }).timeout).toBe(
      undefined,
    )
    expect(() => snapshotOptionsTimeout({ timeout: 101 }, validate, 'x')).toThrow(RangeError)
  })
})

describe('snapshotFixtureTimeouts view', () => {
  it('rejects a guard-fixture override up front and after the snapshot', () => {
    expect(() => snapshotFixtureTimeouts({ guardFixture: undefined }, guard)).toThrow(
      'timeout guard overrides are forbidden by the 100 ms test cap',
    )
    const fixtures: Record<string, unknown> = { a: 1 }
    const view = snapshotFixtureTimeouts(fixtures, guard)
    expect(Object.keys(view)).toEqual(['a'])
    fixtures['guardFixture'] = 1
    expect(() => Object.keys(view)).toThrow(RangeError)
  })

  it('exposes descriptors and values of a frozen input', () => {
    const fixtures = Object.freeze({ a: 1, b: noop })
    const view = snapshotFixtureTimeouts(fixtures, guard)
    expect(Object.getOwnPropertyDescriptor(view, 'a')).toMatchObject({
      value: 1,
      configurable: true,
    })
    expect(Object.getOwnPropertyDescriptor(view, 'missing')).toBeUndefined()
    expect(Reflect.get(view, 'b')).toBe(noop)
  })

  it('normalizes a tuple whose options appear after the snapshot', () => {
    const tuple: unknown[] = [noop]
    const fixtures = { sample: tuple }
    const view = snapshotFixtureTimeouts(fixtures, guard)
    expect(Reflect.get(view, 'sample')).toBe(tuple)
    tuple[1] = { timeout: 10 }
    const normalized = Reflect.get(view, 'sample') as [unknown, { timeout: number }]
    expect(normalized[0]).toBe(noop)
    expect(normalized[1].timeout).toBe(10)
    expect(Reflect.get(view, 'sample')).toBe(normalized)
  })

  it('rejects a late over-cap tuple and passes through non-tuples', () => {
    const tuple: unknown[] = [noop]
    const view = snapshotFixtureTimeouts({ sample: tuple, plain: { timeout: 500 } }, guard)
    expect(Reflect.get(view, 'plain')).toEqual({ timeout: 500 })
    tuple[1] = { timeout: 500 }
    expect(() => Reflect.get(view, 'sample')).toThrow(RangeError)
  })

  it('watches inherited timeout owners for later changes', () => {
    const proto = { timeout: 10 }
    const options = Object.create(proto) as { timeout?: number }
    const fixtures = { sample: [noop, options] }
    snapshotFixtureTimeouts(fixtures, guard)
    expect(snapshotFixtureTimeouts(fixtures, guard)).toBeDefined()
    proto.timeout = 500
    expect(() => snapshotFixtureTimeouts(fixtures, guard)).toThrow(RangeError)
  })

  it('rejects reuse with a different guard and added or removed keys', () => {
    const fixtures: Record<string, unknown> = { sample: [noop, { timeout: 10 }] }
    snapshotFixtureTimeouts(fixtures, guard)
    expect(() => snapshotFixtureTimeouts(fixtures, { ...guard })).toThrow(RangeError)
    fixtures['extra'] = 1
    expect(() => snapshotFixtureTimeouts(fixtures, guard)).toThrow(RangeError)
  })

  it('ignores accessor and non-enumerable entries while validating', () => {
    const fixtures = {
      get lazy() {
        throw new Error('getter must not run')
      },
    }
    Object.defineProperty(fixtures, 'hidden', {
      value: [noop, { timeout: 500 }],
      enumerable: false,
    })
    expect(() => snapshotFixtureTimeouts(fixtures, guard)).not.toThrow()
  })

  it('treats a tuple with an accessor options slot as unknown until read', () => {
    const tuple: unknown[] = [noop]
    Object.defineProperty(tuple, '1', { get: () => ({ timeout: 20 }), enumerable: true })
    expect(() => snapshotFixtureTimeouts({ sample: tuple }, guard)).not.toThrow()
  })
})
