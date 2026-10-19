const CONNECTION_RETRY_DEFAULT_BACKOFF_MS = 5000
const CONNECTION_RETRY_DEFAULT_DURATION_MS = 55_000
const CONNECTION_RETRY_MINIMUM_BACKOFF_MS = 50
const CONNECTION_RETRY_BUDGET_EXCEEDED_MESSAGE = 'connection retry budget exceeded'

function validateRetryInputs(
  backoffMs: number,
  maxDurationMs: number,
  maxRetries: number | undefined,
): void {
  if (!Number.isFinite(backoffMs) || backoffMs <= 0) {
    throw new Error('connection retry backoffMs must be a finite number greater than 0')
  }
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new Error('connection retry maxDurationMs must be a finite number greater than 0')
  }
  if (
    maxRetries !== undefined &&
    (!Number.isFinite(maxRetries) || maxRetries < 0 || !Number.isInteger(maxRetries))
  ) {
    throw new Error('connection retry maxRetries must be a finite non-negative integer')
  }
}

function getDefaultMaxRetries(backoffMs: number, maxDurationMs: number): number {
  return Math.max(1, Math.ceil(maxDurationMs / backoffMs))
}

interface RetryOnConnectionLostOptions {
  backoffMs?: number
  maxRetries?: number
  maxDurationMs?: number
}

const CONNECTION_LOST_PATTERN =
  /\bERR_(CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|SOCKET_NOT_CONNECTED|NETWORK_CHANGED|EMPTY_RESPONSE|ABORTED|INCOMPLETE_CHUNKED_ENCODING)\b/i
const NAVIGATION_TIMEOUT_PATTERN = /\bpage\.goto: Timeout \d+ms exceeded\b/

function isLocalUrl(value: string) {
  try {
    const { hostname } = new URL(value)
    const normalizedHostname = hostname.replace(/^\[(.*)]$/, '$1')
    return ['', 'localhost', '127.0.0.1', '::1'].includes(normalizedHostname)
  } catch {
    return false
  }
}

function isLocalNavigationTimeout(message: string): boolean {
  if (!NAVIGATION_TIMEOUT_PATTERN.test(message)) return false
  const navigatingMatch = message.match(/navigating to "([^"]+)"/)
  const target = navigatingMatch?.[1]
  return target !== undefined && isLocalUrl(target)
}

function isConnectionLostError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return CONNECTION_LOST_PATTERN.test(message) || isLocalNavigationTimeout(message)
}

async function runWithDeadline<T>(fn: () => Promise<T>, deadlineMs: number): Promise<T> {
  if (deadlineMs <= 0) {
    throw new Error(CONNECTION_RETRY_BUDGET_EXCEEDED_MESSAGE)
  }

  let timedOut = false
  let timerId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      timedOut = true
      reject(new Error(CONNECTION_RETRY_BUDGET_EXCEEDED_MESSAGE))
    }, deadlineMs)
  })

  let attempt: Promise<T> | undefined
  try {
    attempt = Promise.resolve().then(fn)
    const result = await Promise.race([attempt, timeout])
    return result
  } catch (err) {
    if (timedOut && attempt) {
      attempt.catch(() => undefined)
    }
    throw err
  } finally {
    clearTimeout(timerId)
  }
}

// Retries fn on transient network/worker errors matched by CONNECTION_LOST_PATTERN
// for a bounded recovery window, using configurable backoff sleeps and a total
// elapsed-time budget to absorb process restart windows, OS-level
// network changes (ERR_NETWORK_CHANGED), and related cold-start races.
export function retryOnConnectionLost<T>(
  fn: () => Promise<T>,
  options: RetryOnConnectionLostOptions = {},
): Promise<T> {
  const backoffMs = options.backoffMs ?? CONNECTION_RETRY_DEFAULT_BACKOFF_MS
  const maxDurationMs = options.maxDurationMs ?? CONNECTION_RETRY_DEFAULT_DURATION_MS
  validateRetryInputs(backoffMs, maxDurationMs, options.maxRetries)
  const effectiveBackoffMs = Math.max(CONNECTION_RETRY_MINIMUM_BACKOFF_MS, backoffMs)
  const maxRetries = options.maxRetries ?? getDefaultMaxRetries(effectiveBackoffMs, maxDurationMs)
  const deadline = Date.now() + maxDurationMs

  const retry = async (remainingRetries: number): Promise<T> => {
    try {
      return await runWithDeadline(fn, deadline - Date.now())
    } catch (err) {
      if (!isConnectionLostError(err) || remainingRetries <= 0) throw err
      const remainingMs = Math.max(0, deadline - Date.now())
      if (remainingMs <= 0) throw err
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(effectiveBackoffMs, remainingMs)),
      )
      if (Date.now() >= deadline) {
        throw new Error(CONNECTION_RETRY_BUDGET_EXCEEDED_MESSAGE, { cause: err })
      }
      return retry(remainingRetries - 1)
    }
  }

  return retry(maxRetries).catch((err) => {
    if (err instanceof Error && err.message === CONNECTION_RETRY_BUDGET_EXCEEDED_MESSAGE) {
      throw new Error(`retryOnConnectionLost: ${CONNECTION_RETRY_BUDGET_EXCEEDED_MESSAGE}`, {
        cause: err,
      })
    }
    throw err
  })
}
