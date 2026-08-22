import type { RequestOptions } from './control.mts'

const FETCH_TIMEOUT_MS = 30_000
const FETCH_ATTEMPTS = 2
const DEFAULT_RETRY_DELAY_MS = 1000

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

async function request(
  method: 'GET' | 'PUT',
  url: string,
  body: Buffer | undefined,
  options: RequestOptions,
): Promise<Response | null> {
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    /* v8 ignore start -- the 30s fetch ceiling is not worth a live wait in unit tests */
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    /* v8 ignore stop */
    try {
      const response = await fetch(url, {
        method,
        ...(body ? { body: new Uint8Array(body) } : {}),
        signal: controller.signal,
      })
      // A missing presigned object is terminal. Let fetchGet yield null or fetchPut yield false
      // without retrying the same URL or emitting a misleading transport-error diagnostic.
      if (response.ok || response.status === 404) return response
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
  return Buffer.from(await response.arrayBuffer())
}
