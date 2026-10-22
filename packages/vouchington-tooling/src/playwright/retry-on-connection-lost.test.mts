import { afterEach, describe, expect, it, vi } from 'vitest'
import { retryOnConnectionLost } from './retry-on-connection-lost.mts'

describe('retryOnConnectionLost', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns value without retry when fn resolves on first call', async () => {
    const fn = vi.fn<() => Promise<unknown>>().mockResolvedValue(42)
    const result = await retryOnConnectionLost(fn)
    expect(result).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-connection errors immediately without retry', async () => {
    const error = new Error('some other error')
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(error)
    await expect(retryOnConnectionLost(fn)).rejects.toBe(error)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once on ERR_CONNECTION_REFUSED and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on ERR_CONNECTION_RESET and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('page.goto: net::ERR_CONNECTION_RESET'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on ERR_CONNECTION_CLOSED and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('page.goto: net::ERR_CONNECTION_CLOSED'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on ERR_SOCKET_NOT_CONNECTED and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('page.goto: net::ERR_SOCKET_NOT_CONNECTED'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on ERR_NETWORK_CHANGED and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('net::ERR_NETWORK_CHANGED'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on ERR_EMPTY_RESPONSE and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('net::ERR_EMPTY_RESPONSE'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on ERR_ABORTED and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('net::ERR_ABORTED'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on ERR_INCOMPLETE_CHUNKED_ENCODING and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('page.goto: net::ERR_INCOMPLETE_CHUNKED_ENCODING'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on local page.goto timeout and returns result', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(
      new Error(
        [
          'page.goto: Timeout 15000ms exceeded.',
          'Call log:',
          '  - navigating to "http://localhost:38267/my/news-preferences", waiting until "domcontentloaded"',
        ].join('\n'),
      ),
    )
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { maxRetries: 1 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry external page.goto timeout', async () => {
    vi.useFakeTimers()
    const error = new Error(
      [
        'page.goto: Timeout 15000ms exceeded.',
        'Call log:',
        '  - navigating to "https://example.com/my/news-preferences", waiting until "domcontentloaded"',
      ].join('\n'),
    )
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(error)

    await expect(retryOnConnectionLost(fn, { maxRetries: 1 })).rejects.toBe(error)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries up to maxRetries times before rethrowing', async () => {
    vi.useFakeTimers()
    const error = new Error('net::ERR_CONNECTION_REFUSED')
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(error)

    const promise = retryOnConnectionLost(fn, { maxRetries: 2 })
    await Promise.all([vi.runAllTimersAsync(), expect(promise).rejects.toBe(error)])
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops retrying once the duration budget is exhausted', async () => {
    vi.useFakeTimers()
    const error = new Error('net::ERR_CONNECTION_REFUSED')
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(error)

    const promise = retryOnConnectionLost(fn, {
      maxRetries: 10,
      backoffMs: 10_000,
      maxDurationMs: 25_000,
    })
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(promise).rejects.toThrow('retryOnConnectionLost: connection retry budget exceeded'),
    ])
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws when backoffMs is zero without explicit maxRetries', () => {
    expect(() => {
      void retryOnConnectionLost(vi.fn<() => Promise<unknown>>(), {
        backoffMs: 0,
        maxDurationMs: 25_000,
      })
    }).toThrow('connection retry backoffMs must be a finite number greater than 0')
  })

  it('throws when maxDurationMs is zero', () => {
    expect(() => {
      void retryOnConnectionLost(vi.fn<() => Promise<unknown>>(), {
        maxDurationMs: 0,
        backoffMs: 5000,
      })
    }).toThrow('connection retry maxDurationMs must be a finite number greater than 0')
  })

  it('throws when maxDurationMs is negative', () => {
    expect(() => {
      void retryOnConnectionLost(vi.fn<() => Promise<unknown>>(), { maxDurationMs: -1 })
    }).toThrow('connection retry maxDurationMs must be a finite number greater than 0')
  })

  it('throws when maxRetries is invalid', () => {
    expect(() => {
      void retryOnConnectionLost(vi.fn<() => Promise<unknown>>(), {
        maxRetries: -1,
        backoffMs: 5000,
      })
    }).toThrow('connection retry maxRetries must be a finite non-negative integer')
  })

  it('stops retrying when an attempt exceeds the remaining budget', async () => {
    vi.useFakeTimers()
    let failAttempt!: (error: Error) => void
    const slowAttempt = new Promise<void>((_resolve, reject) => {
      failAttempt = reject
    })
    const fn = vi.fn<() => Promise<unknown>>().mockReturnValue(slowAttempt)

    const promise = retryOnConnectionLost(fn, { maxDurationMs: 2000, maxRetries: 0 })
    const rejection = promise.then(
      () => {
        throw new Error('Expected retryOnConnectionLost to reject after the budget expires')
      },
      (err) => {
        expect(err).toBeInstanceOf(Error)
        expect(() => {
          throw err
        }).toThrow('retryOnConnectionLost: connection retry budget exceeded')
      },
    )
    await vi.advanceTimersByTimeAsync(4000)
    failAttempt(new Error('late'))
    await rejection
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('derives maxRetries from maxDurationMs and backoffMs when maxRetries is omitted', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
    fn.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
    fn.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { backoffMs: 5000, maxDurationMs: 25_000 })
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('does not retry non-worker-connection errors even with retry budget', async () => {
    vi.useFakeTimers()
    const error = new Error('net::ERR_TLS_CERT_ALTNAME_INVALID')
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(error)

    await expect(retryOnConnectionLost(fn, { maxRetries: 10 })).rejects.toBe(error)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry a timeout whose target is not a URL', async () => {
    const error = new Error(
      'page.goto: Timeout 30000ms exceeded\n  - navigating to "not a url", waiting until "load"',
    )
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(error)

    await expect(retryOnConnectionLost(fn, { backoffMs: 50, maxRetries: 2 })).rejects.toBe(error)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('retries when the failure is not an Error instance', async () => {
    vi.useFakeTimers()
    const fn = vi.fn<() => Promise<unknown>>()
    fn.mockRejectedValueOnce('net::ERR_CONNECTION_REFUSED')
    fn.mockResolvedValueOnce('ok')

    const promise = retryOnConnectionLost(fn, { backoffMs: 50, maxRetries: 1 })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toBe('ok')
  })

  it('fails immediately when the deadline is already past', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_000)
    const fn = vi.fn<() => Promise<unknown>>().mockResolvedValue('ok')

    await expect(
      retryOnConnectionLost(fn, { backoffMs: 50, maxDurationMs: 1_000, maxRetries: 1 }),
    ).rejects.toThrow('retryOnConnectionLost: connection retry budget exceeded')
    expect(fn).not.toHaveBeenCalled()
  })

  it('rethrows the connection error when no budget remains after the attempt', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(0)
    now.mockReturnValueOnce(0)
    now.mockReturnValue(5_000)
    const error = new Error('net::ERR_CONNECTION_REFUSED')
    const fn = vi.fn<() => Promise<unknown>>().mockRejectedValue(error)

    await expect(
      retryOnConnectionLost(fn, { backoffMs: 50, maxDurationMs: 5_000, maxRetries: 3 }),
    ).rejects.toBe(error)
  })
})
