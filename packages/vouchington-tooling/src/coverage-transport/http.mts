import type { RequestOptions } from './control.mts'

const FETCH_TIMEOUT_MS = 30_000
const FETCH_ATTEMPTS = 2
const DEFAULT_RETRY_DELAY_MS = 1000
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024

function formatTransportError(value: unknown, seen: WeakSet<object>): string {
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
  }
  if (value instanceof Error) {
    const cause =
      value.cause !== undefined ? `; cause: ${formatTransportError(value.cause, seen)}` : ''
    return `${value.name}: ${value.message}${cause}`
  }
  return String(value)
}

export function redactTransportLog(value: unknown): string {
  return formatTransportError(value, new WeakSet()).replaceAll(
    /https?:\/\/[^\s]+/g,
    '[redacted-url]',
  )
}

export function coveragePresignFailureLog(error: unknown): string {
  return `[coverage-transport] presign failed: ${redactTransportLog(error)}; artifact fallback required`
}

export function logTransport(options: RequestOptions, line: string): void {
  ;(options.log ?? ((message) => process.stderr.write(`${message}\n`)))(redactTransportLog(line))
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel()
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks)
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('[coverage-transport] GET body exceeds size limit')
    }
    chunks.push(value)
  }
}

interface TransportResponse {
  readonly ok: boolean
  readonly status: number
  readonly body: Buffer | undefined
}

async function request(
  method: 'GET' | 'PUT',
  url: string,
  body: Buffer | undefined,
  options: RequestOptions,
): Promise<TransportResponse | null> {
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method,
        ...(body ? { body: new Uint8Array(body) } : {}),
        signal: controller.signal,
      })
      // A missing presigned object is terminal. Let fetchGet yield null or fetchPut yield false
      // without retrying the same URL or emitting a misleading transport-error diagnostic.
      if (response.ok || response.status === 404) {
        const payload =
          method === 'GET' && response.ok
            ? await readLimitedBody(response, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES)
            : undefined
        if (payload === undefined) await cancelBody(response)
        return { ok: response.ok, status: response.status, body: payload }
      }
      await cancelBody(response)
      logTransport(options, `[coverage-transport] ${method} failed: HTTP ${response.status}`)
    } catch (error) {
      logTransport(options, `[coverage-transport] ${method} error: ${redactTransportLog(error)}`)
    } finally {
      clearTimeout(timer)
    }
    if (attempt < FETCH_ATTEMPTS) {
      await delay(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
    }
  }
  return null
}

export async function fetchPut(
  url: string,
  body: Buffer,
  options: RequestOptions = {},
): Promise<boolean> {
  const response = await request('PUT', url, body, options)
  return response?.ok === true
}

export async function fetchGet(url: string, options: RequestOptions = {}): Promise<Buffer | null> {
  const response = await request('GET', url, undefined, options)
  if (response?.status === 404) return null
  if (!response?.ok) throw new Error('[coverage-transport] GET exhausted')
  return response.body as Buffer
}
