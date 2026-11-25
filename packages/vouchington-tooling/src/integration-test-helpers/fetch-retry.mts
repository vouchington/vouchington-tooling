import { isRetryableTransportError } from './transport-errors.mts'

const DEFAULT_RETRY_BACKOFFS_MS = [250, 500, 1_000, 2_000, 2_000] as const
const DEFAULT_RETRY_BUDGET_MS = 12_000
const DEFAULT_RETRY_ATTEMPT_TIMEOUT_MS = 5_000
const DEFAULT_FIRST_ATTEMPT_TIMEOUT_MS = 20_000
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

export function isIdempotentHttpMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase())
}

export interface FetchWithTransportRetryOptions {
  /** Return `false` for a resolved response that must not escape the caller's boundary. */
  acceptResponse?: (response: Response) => boolean
  idempotent?: boolean
  label: string
  method: string
  timeoutMs?: number
  backoffsMs?: readonly number[]
  budgetMs?: number
  retryAttemptTimeoutMs?: number
  writeDiagnostic?: (line: string) => void
}

export interface RetryOnTransportErrorOptions {
  idempotent: boolean
  label: string
  backoffsMs?: readonly number[]
  budgetMs?: number
  writeDiagnostic?: (line: string) => void
}

export class FetchResponseRejectedError extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string

  constructor(label: string, response: Response) {
    const { status, statusText, url } = response
    super(`[fetch-retry] ${label}: rejected response (${status} ${statusText}) at ${url}`)
    this.name = 'FetchResponseRejectedError'
    this.status = status
    this.statusText = statusText
    this.url = url
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const cause = error.cause as { code?: unknown } | undefined
  return typeof cause?.code === 'string' ? cause.code : error.name
}

function disposeRejectedResponse(response: Response): void {
  void response.body?.cancel().catch(() => {})
}

/**
 * Retries a `fetch()` on retryable transport errors and (for idempotent calls) caller-rejected
 * responses. Constructs a fresh per-attempt `AbortSignal` so retries never reuse an elapsed one.
 */
export async function fetchWithTransportRetry(
  url: string | URL,
  init: Omit<RequestInit, 'signal'>,
  options: FetchWithTransportRetryOptions,
): Promise<Response> {
  const idempotent = options.idempotent ?? isIdempotentHttpMethod(options.method)
  const firstAttemptTimeoutMs = options.timeoutMs ?? DEFAULT_FIRST_ATTEMPT_TIMEOUT_MS
  const backoffsMs = options.backoffsMs ?? DEFAULT_RETRY_BACKOFFS_MS
  const budgetMs = options.budgetMs ?? DEFAULT_RETRY_BUDGET_MS
  const retryAttemptTimeoutMs = options.retryAttemptTimeoutMs ?? DEFAULT_RETRY_ATTEMPT_TIMEOUT_MS
  const writeDiagnostic = options.writeDiagnostic ?? ((line: string) => process.stderr.write(line))
  let retryDeadline: number | undefined
  let lastError: unknown
  let attempt = 0

  for (;;) {
    attempt++
    const attemptTimeoutMs =
      attempt === 1
        ? firstAttemptTimeoutMs
        : Math.min(retryAttemptTimeoutMs, retryDeadline! - Date.now())

    if (attempt > 1 && attemptTimeoutMs <= 0) throw lastError

    let response: Response
    try {
      // oxlint-disable-next-line no-await-in-loop -- each attempt must settle before deciding whether to retry
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(attemptTimeoutMs) })
    } catch (err) {
      lastError = err
      if (!isRetryableTransportError(err, idempotent)) throw err

      if (attempt === 1) retryDeadline = Date.now() + budgetMs

      const backoffMs = backoffsMs[attempt - 1]
      if (backoffMs === undefined || retryDeadline! - Date.now() <= backoffMs) throw err

      writeDiagnostic(
        `[fetch-retry] ${options.label}: attempt ${attempt} failed (${describeError(err)}), retrying in ${backoffMs}ms\n`,
      )
      // oxlint-disable-next-line no-await-in-loop -- intentional backoff between retry attempts
      await delay(backoffMs)
      continue
    }

    if (options.acceptResponse?.(response) !== false) return response

    disposeRejectedResponse(response)
    const error = new FetchResponseRejectedError(options.label, response)
    if (!idempotent) throw error
    lastError = error

    if (attempt === 1) retryDeadline = Date.now() + budgetMs

    const backoffMs = backoffsMs[attempt - 1]
    if (backoffMs === undefined || retryDeadline! - Date.now() <= backoffMs) throw error

    writeDiagnostic(
      `[fetch-retry] ${options.label}: attempt ${attempt} returned a rejected response, retrying in ${backoffMs}ms\n`,
    )
    // oxlint-disable-next-line no-await-in-loop -- intentional backoff between retry attempts
    await delay(backoffMs)
  }
}

/**
 * Retries a whole async operation on retryable transport errors using the same bounded backoff
 * schedule and total retry budget as `fetchWithTransportRetry`.
 */
export async function retryOnTransportError<T>(
  attempt: () => Promise<T>,
  options: RetryOnTransportErrorOptions,
): Promise<T> {
  const backoffsMs = options.backoffsMs ?? DEFAULT_RETRY_BACKOFFS_MS
  const budgetMs = options.budgetMs ?? DEFAULT_RETRY_BUDGET_MS
  const writeDiagnostic = options.writeDiagnostic ?? ((line: string) => process.stderr.write(line))
  let retryDeadline: number | undefined
  let attemptNumber = 0

  for (;;) {
    attemptNumber++
    try {
      // oxlint-disable-next-line no-await-in-loop -- each attempt must settle before deciding whether to retry
      return await attempt()
    } catch (err) {
      if (!options.idempotent || !isRetryableTransportError(err, true)) throw err

      if (attemptNumber === 1) retryDeadline = Date.now() + budgetMs

      const backoffMs = backoffsMs[attemptNumber - 1]
      if (backoffMs === undefined || retryDeadline! - Date.now() <= backoffMs) throw err

      writeDiagnostic(
        `[fetch-retry] ${options.label}: attempt ${attemptNumber} failed (${describeError(err)}), retrying whole operation in ${backoffMs}ms\n`,
      )
      // oxlint-disable-next-line no-await-in-loop -- intentional backoff between retry attempts
      await delay(backoffMs)
      if (Date.now() >= retryDeadline!) throw err
    }
  }
}
