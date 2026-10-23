import { readUntilAborted } from './abort-listeners.mts'
import { forceClientOption } from './force-client-option.mts'
import type { RecordedResponse } from './recorded-response.mts'
import { toReplayResponse } from './replay-response.mts'

// Replays a recorded provider response through the SDK's own `fetch` hook, so the SDK parses real
// wire bytes and no network is touched.

/** What the code under test sent. Header names are lower-cased. */
export type ReplayedRequest = {
  method: string
  url: string
  headers: Record<string, string>
  body: Buffer | undefined
  json: <T = unknown>() => T
}

export type ProviderReplay = {
  /** Pass this as the SDK's `fetch` option. It answers each request with the next queued response. */
  fetch: typeof fetch
  /** Raw HTTP transport: preserve serialized URL bytes instead of fetch URL normalization. */
  sendHttpRequest: (url: string, init?: RequestInit) => Promise<Response>
  /** Every request the SDK sent, in order. */
  requests: ReplayedRequest[]
  /** Queue responses; the SDK receives them in request order. */
  respondWith: (...responses: RecordedResponse[]) => void
  /** Fail when a queued response was never requested, so a skipped call cannot pass silently. */
  assertDrained: () => void
  /** Forget the queue and the captured requests, for a client shared across the tests of a file. */
  reset: () => void
}

export function createProviderReplay(options: { chunkBytes?: number } = {}): ProviderReplay {
  const requests: ReplayedRequest[] = []
  const queue: RecordedResponse[] = []

  // `new Request(...)` applies fetch semantics to the SDK's arguments: the effective URL, method,
  // and headers (a form body brings its own `content-type`), the body bytes, and an abort signal
  // that follows `init.signal`.
  const replayRequest = async (
    request: Request,
    url = request.url,
    headers = request.headers,
  ): Promise<Response> => {
    const { signal } = request
    signal.throwIfAborted()
    // Reserve the request's position and its response before awaiting the body, so concurrent
    // calls keep the order in which they started.
    const sent: ReplayedRequest = {
      method: request.method,
      url,
      headers: Object.fromEntries(headers.entries()),
      body: undefined,
      json: <T,>() => JSON.parse(sent.body?.toString('utf8') ?? 'null') as T,
    }
    requests.push(sent)
    const next = queue.shift()
    if (!next) {
      throw new Error(
        `Provider replay has no recorded response for request ${requests.length}: ${sent.method} ${sent.url}`,
      )
    }
    const bytes = await readUntilAborted(request, signal)
    sent.body = bytes.length === 0 ? undefined : bytes
    return toReplayResponse(next, options.chunkBytes, signal)
  }

  return {
    fetch: async (input, init) => replayRequest(new Request(input, init)),
    sendHttpRequest: async (url, init) =>
      replayRequest(new Request(url, init), url, new Headers(init?.headers)),
    requests,
    respondWith: (...responses) => void queue.push(...responses),
    assertDrained: () => {
      if (queue.length > 0) {
        throw new Error(`Provider replay left ${queue.length} recorded response(s) unrequested`)
      }
    },
    reset: () => {
      requests.length = 0
      queue.length = 0
    },
  }
}

/**
 * Subclasses an SDK client so every instance sends through the replay, whatever `fetch` production
 * code configured. Use it inside a `vi.mock` of the SDK package for a client that production builds
 * itself, so the test never edits production code.
 */
export function replayClient<Client extends abstract new (...args: never[]) => object>(
  Constructor: Client,
  replay: ProviderReplay,
): Client {
  return forceClientOption(Constructor, 'fetch', replay.fetch)
}
