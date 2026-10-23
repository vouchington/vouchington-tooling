import { Readable } from 'node:stream'
import { observeAwsReplayAbort } from './aws-replay-abort-signal.mts'
import { forceClientOption } from './force-client-option.mts'
import type { ProviderReplay } from './provider-replay.mts'

// Serves a recorded response through an AWS SDK v3 client's `requestHandler`, so the SDK still
// serializes, signs, parses and classifies errors itself and nothing touches the network. The
// handler forwards each request to the replay's `fetch`, which captures it and answers with the
// next queued response.

/** The parts of smithy's `HttpRequest` this handler reads. */
type AwsReplayHttpRequest = {
  method: string
  protocol: string
  hostname: string
  port?: number
  path: string
  query?: Record<string, string | string[] | null>
  headers: Record<string, string>
  body?: RequestInit['body']
}

type AwsReplayHandlerOptions = { abortSignal?: unknown }

/** Smithy treats any object with a `handle` function as an `HttpHandler`. */
export type AwsReplayRequestHandler = {
  handle: (
    request: AwsReplayHttpRequest,
    options?: AwsReplayHandlerOptions,
  ) => Promise<{
    response: {
      statusCode: number
      reason: string
      headers: Record<string, string>
      body: Readable
    }
  }>
  destroy: () => void
  updateHttpClientConfig: () => void
  httpHandlerConfigs: () => Record<string, never>
}

export function createAwsReplayRequestHandler(replay: ProviderReplay): AwsReplayRequestHandler {
  return {
    async handle(request, options) {
      const origin = new URL(`${request.protocol}//${request.hostname}`)
      if (request.port) origin.port = String(request.port)
      const query = serializeAwsReplayQuery(request.query ?? {})
      const url = `${origin.origin}${request.path}${query ? `?${query}` : ''}`
      const { signal, detach } = observeAwsReplayAbort(options?.abortSignal)
      try {
        const response = await replay.sendHttpRequest(url, {
          method: request.method,
          headers: request.headers,
          body: request.body ?? null,
          duplex: 'half',
          signal: signal ?? null,
        })
        const body = response.body ? Readable.fromWeb(response.body) : Readable.from([])
        if (response.body) body.once('close', detach)
        else detach()
        return {
          response: {
            statusCode: response.status,
            reason: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body,
          },
        }
      } catch (err) {
        detach()
        throw err
      }
    },
    destroy: () => {},
    updateHttpClientConfig: () => {},
    httpHandlerConfigs: () => ({}),
  }
}

/** Smithy's wire query order and RFC3986 escaping, including bare null keys. */
function serializeAwsReplayQuery(query: NonNullable<AwsReplayHttpRequest['query']>): string {
  const escape = (value: string) =>
    encodeURIComponent(value).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
  return Object.keys(query)
    .toSorted()
    .flatMap((name) => {
      const key = escape(name)
      const value = query[name]
      if (value == null) return key
      return [value].flat().map((part) => `${key}=${escape(part)}`)
    })
    .join('&')
}

/**
 * Subclasses an AWS SDK client so every instance sends through the replay, whatever
 * `requestHandler` production code configured. Use it inside a `vi.mock` of the SDK package for a
 * client that production builds itself, so the test never edits production code.
 */
export function replayAwsClient<Client extends abstract new (config: never) => object>(
  Constructor: Client,
  replay: ProviderReplay,
): Client {
  return forceClientOption(Constructor, 'requestHandler', createAwsReplayRequestHandler(replay))
}
