function collectErrorCodes(error: unknown, codes: Set<string>, depth = 0): void {
  if (depth > 6 || error === null || typeof error !== 'object') return

  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') codes.add(code)

  // AggregateError.errors: undici raises one for a dual-stack ::1/127.0.0.1 connection refusal.
  const errors = (error as { errors?: unknown }).errors
  if (Array.isArray(errors)) {
    for (const inner of errors) collectErrorCodes(inner, codes, depth + 1)
  }

  const cause = (error as { cause?: unknown }).cause
  if (cause !== undefined) collectErrorCodes(cause, codes, depth + 1)
}

/**
 * Walks `error.cause` and nested `AggregateError.errors` to decide whether a transport error is
 * safe to retry. Connection refusals (`ECONNREFUSED`) are always retryable because the request
 * never reached the server; mid-flight socket drops (`UND_ERR_SOCKET`, `ECONNRESET`) are retryable
 * only when `idempotent` is true. Caller timeouts (`AbortError`, `TimeoutError`) are never retried.
 */
export function isRetryableTransportError(error: unknown, idempotent: boolean): boolean {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return false
  }

  const codes = new Set<string>()
  collectErrorCodes(error, codes)

  if (codes.has('ECONNREFUSED')) return true
  if (idempotent && (codes.has('UND_ERR_SOCKET') || codes.has('ECONNRESET'))) return true
  return false
}
