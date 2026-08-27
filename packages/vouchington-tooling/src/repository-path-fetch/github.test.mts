import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGithubJson, MAX_BLOB_BYTES, MAX_BLOB_RESPONSE_BYTES } from './github.mts'

afterEach(() => vi.unstubAllGlobals())

describe('getGithubJson', () => {
  it('budgets for base64 expansion and JSON framing around a maximum-size blob', () => {
    expect(MAX_BLOB_RESPONSE_BYTES).toBeGreaterThan(Math.ceil((MAX_BLOB_BYTES * 4) / 3))
  })
  it.each(['', 'token\n', 'token value', 'token\u0000', 'token%0d%0aheader', 'x'.repeat(1025)])(
    'rejects unsafe token %j',
    async (token) => {
      await expect(getGithubJson(new URL('https://api.example/'), 'value', token)).rejects.toThrow(
        'token contains whitespace or control characters',
      )
    },
  )
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid response limit: %s',
    async (limit) => {
      await expect(
        getGithubJson(new URL('https://api.example/'), 'value', 'token', limit),
      ).rejects.toThrow('response limit must be positive')
    },
  )

  it('rejects an oversized Content-Length before reading the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{}', { headers: { 'content-length': '4' } })),
    )
    await expect(
      getGithubJson(new URL('https://api.example/'), 'value', 'token', 3),
    ).rejects.toThrow('exceeds size limit')
  })

  it('rejects an oversized streamed body without a Content-Length', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(Buffer.from('{}'))
      },
    })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body)))
    await expect(
      getGithubJson(new URL('https://api.example/'), 'value', 'token', 1),
    ).rejects.toThrow('exceeds size limit')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects successful responses without a readable body', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null)))
    await expect(getGithubJson(new URL('https://api.example/'), 'value', 'token')).rejects.toThrow(
      'has no body',
    )
  })

  it('passes a timeout signal through fetch and propagates its abort', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation((_url, init) => {
          const signal = init?.signal
          return new Promise((_, reject) =>
            signal?.addEventListener('abort', () => reject(signal.reason)),
          )
        }),
      )
      const pending = getGithubJson(new URL('https://api.example/'), 'value', 'token', 10, 1)
      await vi.advanceTimersByTimeAsync(1)
      await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
      expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      vi.useRealTimers()
    }
  })
})
