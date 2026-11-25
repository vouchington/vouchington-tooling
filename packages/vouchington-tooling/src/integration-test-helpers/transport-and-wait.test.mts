import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FetchResponseRejectedError,
  fetchWithTransportRetry,
  isHealthy,
  isIdempotentHttpMethod,
  isRetryableTransportError,
  poll,
  retryOnTransportError,
  waitFor,
} from './index.mts'

function makeResponse(
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit & { url?: string } = {},
): Response {
  const { url, ...responseInit } = init
  const response = new Response(body, responseInit)
  if (url) Object.defineProperty(response, 'url', { value: url })
  return response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('isRetryableTransportError and isIdempotentHttpMethod', () => {
  it('classifies HTTP methods and transport error codes across cause and AggregateError chains', () => {
    expect(isIdempotentHttpMethod('get')).toBe(true)
    expect(isIdempotentHttpMethod('HEAD')).toBe(true)
    expect(isIdempotentHttpMethod('options')).toBe(true)
    expect(isIdempotentHttpMethod('POST')).toBe(false)

    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    const timeoutErr = new Error('timed out')
    timeoutErr.name = 'TimeoutError'
    expect(isRetryableTransportError(abortErr, true)).toBe(false)
    expect(isRetryableTransportError(timeoutErr, true)).toBe(false)

    const refused = new AggregateError([
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    ])
    expect(isRetryableTransportError(refused, false)).toBe(true)

    const socketDrop = new Error('wrap', { cause: { code: 'UND_ERR_SOCKET' } })
    expect(isRetryableTransportError(socketDrop, false)).toBe(false)
    expect(isRetryableTransportError(socketDrop, true)).toBe(true)

    const reset = new Error('wrap', { cause: { code: 'ECONNRESET' } })
    expect(isRetryableTransportError(reset, true)).toBe(true)

    // Deeply nested beyond depth 6 stops walking.
    let deep: unknown = { code: 'ECONNREFUSED' }
    for (let i = 0; i < 8; i++) deep = { cause: deep }
    expect(isRetryableTransportError(deep, true)).toBe(false)
    expect(isRetryableTransportError('plain-string', true)).toBe(false)
    expect(isRetryableTransportError(null, true)).toBe(false)
  })
})

describe('fetchWithTransportRetry and retryOnTransportError', () => {
  it('retries rejected idempotent responses, cancels rejected streams, and accepts valid non-2xx', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn<() => Promise<void>>(async () => {
      throw new Error('cancel ignored')
    })
    const rejected = makeResponse(
      new ReadableStream({
        cancel,
        start(controller) {
          controller.enqueue(new TextEncoder().encode('restart banner'))
        },
      }),
    )
    const accepted = makeResponse('final response', {
      status: 404,
      headers: { 'x-request-id': 'req-1' },
      url: 'https://worker.example/final',
    })
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(accepted)
    vi.stubGlobal('fetch', fetchMock)

    const diagnostics: string[] = []
    const result = fetchWithTransportRetry(
      'https://worker.example/retry',
      {},
      {
        label: '/retry',
        method: 'GET',
        acceptResponse: (response) => response.headers.has('x-request-id'),
        writeDiagnostic: (line) => diagnostics.push(line),
      },
    )
    await vi.advanceTimersByTimeAsync(250)

    await expect(result).resolves.toBe(accepted)
    expect(cancel).toHaveBeenCalledOnce()
    expect(diagnostics).toHaveLength(1)
  })

  it('does not retry rejected non-idempotent responses and exhausts schedules for repeated failures', async () => {
    vi.useFakeTimers()
    const rejected = makeResponse('restart banner', {
      status: 503,
      statusText: 'Worker restarting',
      url: 'https://worker.example/mutation',
    })
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(rejected)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchWithTransportRetry(
        'https://worker.example/mutation',
        {},
        {
          label: '/mutation',
          method: 'POST',
          acceptResponse: (response) => response.headers.has('x-request-id'),
        },
      ),
    ).rejects.toMatchObject({
      name: 'FetchResponseRejectedError',
      status: 503,
      statusText: 'Worker restarting',
      url: 'https://worker.example/mutation',
    })

    // Exhaust retry budget for rejected GET responses.
    const exhausted = fetchWithTransportRetry(
      'https://worker.example/exhaust',
      {},
      {
        label: '/exhaust',
        method: 'GET',
        backoffsMs: [100],
        budgetMs: 500,
        acceptResponse: () => false,
        writeDiagnostic: () => {},
      },
    )
    const caught = exhausted.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(100)
    await expect(caught).resolves.toBeInstanceOf(FetchResponseRejectedError)
  })

  it('retries transport errors, handles budget expiry, and respects non-retryable errors', async () => {
    vi.useFakeTimers()
    const transportErr = new Error('reset', { cause: { code: 'ECONNRESET' } })
    const nonErrorRefused = { code: 'ECONNREFUSED' }
    const ok = makeResponse('ok')
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(transportErr)
      .mockRejectedValueOnce(nonErrorRefused)
      .mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', fetchMock)

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const pending = fetchWithTransportRetry(
        'https://worker.example/ok',
        {},
        { label: '/ok', method: 'GET' },
      )
      await vi.advanceTimersByTimeAsync(750)
      await expect(pending).resolves.toBe(ok)
      expect(stderrSpy).toHaveBeenCalled()
    } finally {
      stderrSpy.mockRestore()
    }

    // Non-retryable error fails immediately without waiting.
    const fatal = new Error('boom')
    fetchMock.mockReset().mockRejectedValueOnce(fatal)
    await expect(
      fetchWithTransportRetry(
        'https://worker.example/fatal',
        {},
        { label: '/fatal', method: 'GET' },
      ),
    ).rejects.toBe(fatal)

    // Retry attempt whose budget expires during backoff throws lastError immediately.
    fetchMock.mockReset().mockImplementation(async () => {
      vi.advanceTimersByTime(1_000)
      throw transportErr
    })
    const expired = fetchWithTransportRetry(
      'https://worker.example/expired',
      {},
      {
        label: '/expired',
        method: 'GET',
        backoffsMs: [10, 10],
        budgetMs: 500,
        writeDiagnostic: () => {},
      },
    )
    const expiredErr = expired.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(10)
    await expect(expiredErr).resolves.toBe(transportErr)

    // Retry attempt whose clock drifts past retryDeadline during backoff throws lastError immediately.
    fetchMock.mockReset().mockRejectedValue(transportErr)
    const drifted = fetchWithTransportRetry(
      'https://worker.example/drifted',
      {},
      {
        label: '/drifted',
        method: 'GET',
        backoffsMs: [10],
        budgetMs: 500,
        writeDiagnostic: () => {
          vi.setSystemTime(Date.now() + 1_000)
        },
      },
    )
    const driftedErr = drifted.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(10)
    await expect(driftedErr).resolves.toBe(transportErr)

    // When backoff exceeds remaining budget, throws immediately.
    fetchMock.mockReset().mockRejectedValue(transportErr)
    await expect(
      fetchWithTransportRetry(
        'https://worker.example/tiny-budget',
        {},
        { label: '/tiny', method: 'GET', backoffsMs: [100], budgetMs: 50 },
      ),
    ).rejects.toBe(transportErr)
  })

  it('retries whole operations preserving AsyncLocalStorage context and stops on non-retryable errors', async () => {
    vi.useFakeTimers()
    const context = new AsyncLocalStorage<object>()
    const owner = {}
    const err = new Error('refused', { cause: { code: 'ECONNREFUSED' } })
    let tries = 0
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const result = context.run(owner, () =>
        retryOnTransportError(
          async () => {
            expect(context.getStore()).toBe(owner)
            tries += 1
            if (tries < 3)
              throw tries === 1 ? err : Object.assign(new Error('plain'), { code: 'ECONNREFUSED' })
            return 'done'
          },
          { idempotent: true, label: 'op' },
        ),
      )
      await vi.advanceTimersByTimeAsync(750)
      await expect(result).resolves.toBe('done')
    } finally {
      stderrSpy.mockRestore()
    }

    // Exhausted retries propagate final error; non-retryable error propagates immediately.
    const exhausted = retryOnTransportError(
      async () => {
        throw err
      },
      {
        idempotent: true,
        label: 'exhaust',
        backoffsMs: [10],
        budgetMs: 100,
        writeDiagnostic: () => {},
      },
    )
    const caught = exhausted.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(10)
    await expect(caught).resolves.toBe(err)

    const appErr = new Error('app failure')
    await expect(
      retryOnTransportError(
        async () => {
          throw appErr
        },
        { idempotent: true, label: 'app' },
      ),
    ).rejects.toBe(appErr)
  })
})

describe('waitFor, isHealthy, and poll', () => {
  it('polls serially, times out cleanly, and checks HTTP health with/without AbortSignal', async () => {
    vi.useFakeTimers()
    let probeCount = 0
    const waiting = waitFor(
      'service',
      async () => {
        probeCount += 1
        return probeCount === 2
      },
      1_000,
      100,
    )
    await vi.advanceTimersByTimeAsync(100)
    await waiting
    expect(probeCount).toBe(2)

    const timeoutWait = waitFor('never-ready', async () => false, 150, 100)
    const waitErr = timeoutWait.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(200)
    expect(await waitErr).toMatchObject({ message: 'Timed out waiting for never-ready' })

    // Default intervalMs + pre-aborted signal.
    const ac = new AbortController()
    ac.abort(new Error('cancelled'))
    await expect(
      waitFor('aborted', async () => false, 1_000, undefined, ac.signal),
    ).rejects.toThrow('cancelled')

    // poll succeeds and times out.
    let reads = 0
    const polling = poll(
      async () => ++reads,
      (v) => v === 2,
      1_000,
      50,
    )
    await vi.advanceTimersByTimeAsync(50)
    await expect(polling).resolves.toBe(2)

    const pollTimeout = poll(
      async () => 0,
      (v) => v === 1,
      100,
    )
    const pollErr = pollTimeout.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(300)
    expect(await pollErr).toMatchObject({ message: 'Polling timed out after 100ms' })

    // isHealthy checks status list, ignores body cancel errors, and handles fetch rejection.
    const cancelRejectingResponse = new Response(
      new ReadableStream({
        cancel: async () => {
          throw new Error('cancel failure')
        },
      }),
      { status: 200 },
    )
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(cancelRejectingResponse)
      .mockRejectedValueOnce(new Error('network'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(isHealthy('http://127.0.0.1:9/health', [200, 204])).resolves.toBe(true)
    const liveAc = new AbortController()
    await expect(isHealthy('http://127.0.0.1:9/health', undefined, liveAc.signal)).resolves.toBe(
      false,
    )
  })
})
