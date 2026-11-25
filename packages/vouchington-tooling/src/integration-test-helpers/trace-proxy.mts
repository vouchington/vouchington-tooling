import http from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ASSET_CONCURRENCY_PATH, createAssetConcurrencyBroker } from './concurrency-broker.mts'
import { isFetchSafePort } from './fetch-ports.mts'
import { listenOnFetchSafeEphemeralPort } from './ports.mts'

export interface TracedRequest {
  method: string
  path: string
  status: number
  durationMs: number
  cookieHeader: string | null
  userAgent: string | null
  requestId: string | null
}

export interface TraceProxyHandle {
  origin: string
  close: () => Promise<void>
}

export interface CreateTraceProxyOptions {
  assetConcurrencyLimit?: number
  healthPath?: string
  requestsPath?: string
  concurrencyPath?: string
}

const DEFAULT_TRACE_REQUESTS_PATH = '/__trace/requests'
const DEFAULT_TRACE_HEALTH_PATH = '/__trace/health'

/**
 * Starts a loopback streaming HTTP proxy that forwards requests to `targetOrigin`, records
 * metadata (including `x-request-id` for parallel test isolation), exposes `/__trace/health` and
 * `/__trace/requests`, and hosts an asset-concurrency broker.
 */
export async function createTraceProxy(
  port: number,
  targetOrigin: string,
  options: CreateTraceProxyOptions = {},
): Promise<TraceProxyHandle> {
  if (port !== 0 && !isFetchSafePort(port)) {
    throw new Error(`Trace proxy port ${String(port)} is forbidden by Fetch`)
  }

  const healthPath = options.healthPath ?? DEFAULT_TRACE_HEALTH_PATH
  const requestsPath = options.requestsPath ?? DEFAULT_TRACE_REQUESTS_PATH
  const tracedRequests: TracedRequest[] = []
  const assetConcurrencyBroker = createAssetConcurrencyBroker(
    options.assetConcurrencyLimit ?? 6,
    options.concurrencyPath ?? ASSET_CONCURRENCY_PATH,
  )

  const server = http.createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', `http://127.0.0.1:${port}`)

    if (assetConcurrencyBroker.handle(url.pathname, outgoing)) return

    if (url.pathname === healthPath) {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' })
      outgoing.end(JSON.stringify({ ok: true }))
      return
    }

    if (url.pathname === requestsPath) {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' })
      outgoing.end(JSON.stringify({ requests: tracedRequests }))
      return
    }

    const startedAt = Date.now()
    const requestUrl = new URL(url.pathname + url.search, targetOrigin)
    const headers = buildUpstreamHeaders(incoming.headers, requestUrl.host)

    const abortController = new AbortController()
    const abort = (): void => abortController.abort()
    incoming.once('aborted', abort)
    outgoing.once('close', abort)

    let response: Response
    try {
      const requestInit: RequestInit & { duplex: 'half' } = {
        method: incoming.method ?? 'GET',
        headers,
        body: shouldSendBody(incoming.method)
          ? (Readable.toWeb(incoming) as unknown as globalThis.ReadableStream<Uint8Array>)
          : null,
        duplex: 'half',
        signal: abortController.signal,
      }
      response = await fetch(requestUrl, requestInit)
    } catch (err) {
      incoming.off('aborted', abort)
      outgoing.off('close', abort)
      if (abortController.signal.aborted || outgoing.destroyed || outgoing.writableEnded) return
      outgoing.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      outgoing.end(`Trace proxy failed: ${err instanceof Error ? err.message : 'unknown error'}`)
      return
    }

    tracedRequests.push({
      method: incoming.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      status: response.status,
      durationMs: Date.now() - startedAt,
      cookieHeader: headers.get('cookie'),
      userAgent: headers.get('user-agent'),
      requestId: headers.get('x-request-id'),
    })

    const responseHeaders = new Headers(response.headers)
    stripHopByHopHeaders(responseHeaders)
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')

    const outgoingHeaders: http.OutgoingHttpHeaders = Object.fromEntries(responseHeaders.entries())
    const setCookies = responseHeaders.getSetCookie()
    if (setCookies.length > 0) outgoingHeaders['set-cookie'] = setCookies
    outgoing.writeHead(response.status, outgoingHeaders)
    try {
      if (response.body) {
        await pipeline(Readable.from(response.body as AsyncIterable<Uint8Array>), outgoing)
      } else {
        outgoing.end()
      }
    } catch (err) {
      if (!abortController.signal.aborted) outgoing.destroy(err as Error)
    } finally {
      incoming.off('aborted', abort)
      outgoing.off('close', abort)
    }
  })

  const boundPort =
    port === 0
      ? await listenOnFetchSafeEphemeralPort(server)
      : await listenOnExactLoopbackPort(server, port)

  return {
    origin: `http://127.0.0.1:${boundPort}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export function buildUpstreamHeaders(
  incomingHeaders: http.IncomingHttpHeaders,
  host: string,
): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '))
    else if (value !== undefined) headers.set(key, value)
  }
  stripHopByHopHeaders(headers)
  if (!headers.has('host')) headers.set('host', host)
  headers.set('accept-encoding', 'identity')
  headers.delete('content-length')
  return headers
}

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const

async function listenOnExactLoopbackPort(server: http.Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return port
}

function shouldSendBody(method: string | undefined): boolean {
  return !(method === 'GET' || method === 'HEAD' || method === undefined)
}

function stripHopByHopHeaders(headers: Headers): void {
  const connectionTokens = (headers.get('connection') ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  for (const name of [...connectionTokens, ...HOP_BY_HOP_HEADERS]) {
    headers.delete(name)
  }
}
