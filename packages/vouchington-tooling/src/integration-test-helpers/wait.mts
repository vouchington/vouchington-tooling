import { setTimeout as delay } from 'node:timers/promises'

/** Polls an async readiness probe serially until it returns `true` or `timeoutMs` elapses. */
export async function waitFor(
  label: string,
  fn: (signal?: AbortSignal) => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
  signal?: AbortSignal,
): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- each readiness probe must settle before the next begins
    if (await fn(signal)) {
      return
    }

    // oxlint-disable-next-line no-await-in-loop -- delay after a failed probe so retries do not overlap
    await delay(intervalMs, undefined, { signal })
  }

  throw new Error(`Timed out waiting for ${label}`)
}

/** Issues a bounded HTTP probe and returns `true` when the status is in `validStatuses`. */
export async function isHealthy(
  url: string,
  validStatuses: readonly number[] = [200],
  signal?: AbortSignal,
  probeTimeoutMs = 5_000,
): Promise<boolean> {
  try {
    const fetchSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(probeTimeoutMs)])
      : AbortSignal.timeout(probeTimeoutMs)
    const response = await fetch(url, { signal: fetchSignal })
    void response.body?.cancel().catch(() => {})
    return validStatuses.includes(response.status)
  } catch {
    return false
  }
}

/** Polls `fn()` serially until `predicate(value)` returns `true` or `timeoutMs` elapses. */
export async function poll<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    // oxlint-disable-next-line no-await-in-loop -- each poll must settle before the next begins
    const value = await fn()
    if (predicate(value)) {
      return value
    }

    // oxlint-disable-next-line no-await-in-loop -- keep polling attempts ordered and non-overlapping
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs)
    })
  }

  throw new Error(`Polling timed out after ${timeoutMs}ms`)
}
