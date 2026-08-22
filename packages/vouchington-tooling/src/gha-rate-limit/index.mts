const MAX_DELAY_MS = 60_000
export const MAX_RATE_LIMIT_WAIT_MS = 120_000

export class GitHubRateLimitError extends Error {
  readonly code: string
  readonly httpStatus?: number | undefined
  readonly retryAfter?: string | undefined
  readonly rateLimitRemaining?: string | undefined
  readonly rateLimitReset?: string | undefined

  constructor(
    code: string,
    message: string,
    httpStatus?: number,
    retryAfter?: string,
    rateLimitRemaining?: string,
    rateLimitReset?: string,
  ) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
    this.retryAfter = retryAfter
    this.rateLimitRemaining = rateLimitRemaining
    this.rateLimitReset = rateLimitReset
    this.name = 'GitHubRateLimitError'
  }
}

function invalid(): never {
  throw new GitHubRateLimitError('INVALID_RESPONSE', 'GitHub rate-limit response is invalid')
}

function rateLimit403(error: GitHubRateLimitError) {
  return (
    error.httpStatus === 403 && (error.retryAfter !== undefined || error.rateLimitRemaining === '0')
  )
}

export function isRetryableCancellationError(error: unknown) {
  return (
    error instanceof GitHubRateLimitError &&
    (error.code === 'REQUEST_FAILED' ||
      (error.code === 'HTTP_STATUS' &&
        (error.httpStatus === 429 ||
          rateLimit403(error) ||
          ((error.httpStatus ?? 0) >= 500 && (error.httpStatus ?? 0) <= 599))))
  )
}

export function rateLimitDelay(error: GitHubRateLimitError) {
  if (error.retryAfter !== undefined) {
    if (!/^\d+$/u.test(error.retryAfter)) invalid()
    const milliseconds = Number(error.retryAfter) * 1000
    if (!Number.isSafeInteger(milliseconds) || milliseconds > MAX_DELAY_MS) invalid()
    return milliseconds
  }
  if (error.rateLimitRemaining !== undefined && !/^\d+$/u.test(error.rateLimitRemaining)) invalid()
  if (error.rateLimitRemaining !== '0') {
    if (error.httpStatus !== 429) invalid()
    return MAX_DELAY_MS
  }
  if (!error.rateLimitReset || !/^\d+$/u.test(error.rateLimitReset)) invalid()
  const reset = Number(error.rateLimitReset)
  if (!Number.isSafeInteger(reset)) invalid()
  const milliseconds = Math.max(0, reset * 1000 - Date.now())
  if (milliseconds > MAX_DELAY_MS) invalid()
  return milliseconds
}

export function isRateLimited(error: unknown): error is GitHubRateLimitError {
  return (
    error instanceof GitHubRateLimitError &&
    error.code === 'HTTP_STATUS' &&
    (error.httpStatus === 429 || rateLimit403(error))
  )
}

export function reserveRateLimitDelay(used: { milliseconds: number }, delay: number) {
  if (used.milliseconds + delay > MAX_RATE_LIMIT_WAIT_MS) {
    throw new GitHubRateLimitError(
      'RATE_LIMIT_WAIT_EXHAUSTED',
      'GitHub rate-limit wait budget is exhausted',
    )
  }
  used.milliseconds += delay
}
