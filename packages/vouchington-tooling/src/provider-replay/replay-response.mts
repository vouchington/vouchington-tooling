import { onAbort } from './abort-listeners.mts'
import type { RecordedResponse } from './recorded-response.mts'

/**
 * Builds the `Response` an SDK reads. The body streams in `chunkBytes` pieces (default: one), so a
 * small value proves the consumer does not depend on events arriving aligned to chunk boundaries.
 * When the request's `signal` aborts while the body is being read, the stream errors with the
 * signal's reason, as a real transport does.
 */
export function toReplayResponse(
  recorded: RecordedResponse,
  chunkBytes?: number,
  signal?: AbortSignal | null,
): Response {
  const size = chunkBytes ?? Math.max(recorded.body.length, 1)
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError(`chunkBytes must be a positive integer, received ${chunkBytes}`)
  }
  let offset = 0
  let detach!: () => void
  const body =
    recorded.body.length === 0
      ? null
      : new ReadableStream<Uint8Array>({
          start(controller) {
            detach = onAbort(signal, () => controller.error(signal?.reason))
          },
          pull(controller) {
            if (signal?.aborted) return controller.error(signal.reason)
            if (offset >= recorded.body.length) {
              detach()
              return controller.close()
            }
            controller.enqueue(recorded.body.subarray(offset, offset + size))
            offset += size
          },
          cancel: detach,
        })
  return new Response(body, {
    status: recorded.status,
    statusText: recorded.statusText,
    headers: recorded.headers,
  })
}
