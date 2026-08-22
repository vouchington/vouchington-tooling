import { describe, expect, it, vi } from 'vitest'

import {
  MissingResponseBodyError,
  readResponseBody,
  readResponseBodyAsBuffer,
  ResponseBodyTooLargeError,
} from './index.mts'

function responseFromChunks(chunks: readonly string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
  )
}

describe('http-body', () => {
  it('reads text and binary response bodies', async () => {
    const response = responseFromChunks(['hel', 'lo'])
    expect(await readResponseBody({ response, url: 'https://example.test', maxSizeBytes: 5 })).toBe(
      'hello',
    )
  })

  it('rejects missing bodies and invalid limits', async () => {
    await expect(
      readResponseBodyAsBuffer({
        response: new Response(null),
        url: 'https://example.test/empty',
        maxSizeBytes: 1,
      }),
    ).rejects.toBeInstanceOf(MissingResponseBodyError)
    await expect(
      readResponseBodyAsBuffer({
        response: responseFromChunks([]),
        url: 'https://example.test',
        maxSizeBytes: -1,
      }),
    ).rejects.toBeInstanceOf(RangeError)
    for (const maxSizeBytes of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(
        readResponseBodyAsBuffer({
          response: responseFromChunks([]),
          url: 'https://example.test',
          maxSizeBytes,
        }),
      ).rejects.toBeInstanceOf(RangeError)
    }
  })

  it('cancels and reports the observed size on overflow', async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
        },
        cancel,
      }),
    )
    const error = await readResponseBodyAsBuffer({
      response,
      url: 'https://example.test/large',
      maxSizeBytes: 2,
    }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ResponseBodyTooLargeError)
    expect(error).toMatchObject({ sizeBytes: 3, maxSizeBytes: 2 })
    expect(cancel).toHaveBeenCalled()
  })

  it('preserves the size error when cancellation itself rejects', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
        },
        cancel() {
          return Promise.reject(new Error('cancel failed'))
        },
      }),
    )
    await expect(
      readResponseBodyAsBuffer({
        response,
        url: 'https://example.test/rejecting-cancel',
        maxSizeBytes: 2,
      }),
    ).rejects.toMatchObject({ sizeBytes: 3, maxSizeBytes: 2 })
  })

  it('propagates abort reasons and cancels the reader', async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => undefined)
        },
        cancel,
      }),
    )
    const controller = new AbortController()
    const reason = new Error('stop')
    const pending = readResponseBodyAsBuffer({
      response,
      url: 'https://example.test/slow',
      maxSizeBytes: 10,
      signal: controller.signal,
    })
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledWith(reason)
  })

  it('normalizes non-Error and absent abort reasons', async () => {
    for (const [reason, expectedMessage] of [
      ['stop-string', 'stop-string'],
      [undefined, 'HTTP response body read aborted'],
    ] as const) {
      const cancel = vi.fn()
      const response = new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            return new Promise(() => undefined)
          },
          cancel,
        }),
      )
      const signal = {
        aborted: true,
        reason,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as AbortSignal
      await expect(
        readResponseBodyAsBuffer({
          response,
          url: 'https://example.test/aborted',
          maxSizeBytes: 10,
          signal,
        }),
      ).rejects.toMatchObject({ message: expectedMessage })
      expect(cancel).toHaveBeenCalled()
    }
  })

  it('swallows cancellation failures raised by an already-aborted signal', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => undefined)
        },
        cancel() {
          return Promise.reject(new Error('cancel failed'))
        },
      }),
    )
    const signal = {
      aborted: true,
      reason: 'stop',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal
    await expect(
      readResponseBodyAsBuffer({
        response,
        url: 'https://example.test/aborted-cancel',
        maxSizeBytes: 10,
        signal,
      }),
    ).rejects.toMatchObject({ message: 'stop' })
  })

  it('swallows cancellation failures while propagating a reader failure', async () => {
    const readError = new Error('read failed')
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          return Promise.reject(readError)
        },
        cancel() {
          return Promise.reject(new Error('cancel failed'))
        },
      }),
    )
    await expect(
      readResponseBodyAsBuffer({
        response,
        url: 'https://example.test/read-failure',
        maxSizeBytes: 10,
      }),
    ).rejects.toBe(readError)
  })

  it('supports an exact zero-byte limit for an empty stream', async () => {
    await expect(
      readResponseBodyAsBuffer({
        response: responseFromChunks([]),
        url: 'https://example.test/empty',
        maxSizeBytes: 0,
      }),
    ).resolves.toEqual(Buffer.alloc(0))
  })
})
