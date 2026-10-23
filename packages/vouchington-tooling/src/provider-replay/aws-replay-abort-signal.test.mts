import { describe, expect, it, vi } from 'vitest'
import { observeAwsReplayAbort } from './aws-replay-abort-signal.mts'

describe('shared legacy AWS abort signals', () => {
  it.each([
    [0, 1],
    [1, 0],
  ] as const)('detaches observers in completion order %s then %s', (first, last) => {
    const original = vi.fn<() => void>()
    const source = { aborted: false, onabort: original }
    const observers = [observeAwsReplayAbort(source), observeAwsReplayAbort(source)] as const
    observers[first].detach()
    source.aborted = true
    source.onabort()
    expect(observers[first].signal?.aborted).toBe(false)
    expect(observers[last].signal?.aborted).toBe(true)
    expect(original).toHaveBeenCalledOnce()
    observers[last].detach()
    expect(source.onabort).toBe(original)
  })

  it('re-installs a fresh observer when onabort was replaced by the caller', () => {
    const source: { aborted: boolean; onabort: (() => void) | null } = {
      aborted: false,
      onabort: null,
    }
    const first = observeAwsReplayAbort(source)
    const replaced = vi.fn<() => void>()
    source.onabort = replaced
    const second = observeAwsReplayAbort(source)
    second.detach()
    expect(source.onabort).toBe(replaced)
    first.detach()
    expect(source.onabort).toBe(replaced)
  })
})

describe('AWS abort signal inputs', () => {
  it('passes through nullish and native signals', () => {
    const native = new AbortController().signal
    expect(observeAwsReplayAbort(undefined).signal).toBeUndefined()
    expect(observeAwsReplayAbort(null).signal).toBeUndefined()
    const observed = observeAwsReplayAbort(native)
    expect(observed.signal).toBe(native)
    expect(() => observed.detach()).not.toThrow()
  })

  it.each([42, {}, { aborted: 'no' }])('rejects the invalid signal %j', (value) => {
    expect(() => observeAwsReplayAbort(value)).toThrow('Invalid AWS request abort signal')
  })

  it('rejects a signal with no notification API', () => {
    expect(() => observeAwsReplayAbort({ aborted: false })).toThrow(/no notification API/)
  })

  it('aborts immediately for an already aborted structural signal', () => {
    const reason = new Error('already')
    const observed = observeAwsReplayAbort({ aborted: true, reason })
    expect(observed.signal?.reason).toBe(reason)
    expect(() => observed.detach()).not.toThrow()
  })

  it('catches an abort that races with installing the observer', () => {
    const reason = new Error('raced')
    const source = {
      aborted: false,
      reason,
      addEventListener: vi.fn(() => {
        source.aborted = true
      }),
      removeEventListener: vi.fn(),
    }
    expect(observeAwsReplayAbort(source).signal?.reason).toBe(reason)
  })
})
