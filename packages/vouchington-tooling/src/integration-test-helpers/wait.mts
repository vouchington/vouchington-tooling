import { setTimeout as delay } from 'node:timers/promises'

function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

/** Polls an async readiness probe serially until it returns `true` or `timeoutMs` elapses. */
export async function waitFor(
  label: string,
  fn: (signal?: AbortSignal) => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const timeoutError = new Error(`Timed out waiting for ${label}`)
  if (timeoutMs <= 0) throw timeoutError

  const deadlineController = new AbortController()
  const timer = setTimeout(() => deadlineController.abort(timeoutError), timeoutMs)
  const effectiveSignal = signal
    ? AbortSignal.any([signal, deadlineController.signal])
    : deadlineController.signal

  try {
    for (;;) {
      effectiveSignal.throwIfAborted()
      // oxlint-disable-next-line no-await-in-loop -- each readiness probe must settle before the next begins
      if (await raceWithSignal(fn(effectiveSignal), effectiveSignal)) return
      // oxlint-disable-next-line no-await-in-loop -- delay after a failed probe so retries do not overlap
      await delay(intervalMs, undefined, { signal: effectiveSignal })
    }
  } catch (err) {
    if (effectiveSignal.aborted) throw effectiveSignal.reason
    throw err
  } finally {
    clearTimeout(timer)
  }
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
  const timeoutError = new Error(`Polling timed out after ${timeoutMs}ms`)
  if (timeoutMs <= 0) throw timeoutError

  const deadlineController = new AbortController()
  const timer = setTimeout(() => deadlineController.abort(timeoutError), timeoutMs)
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- each poll must settle before the next begins
      const value = await raceWithSignal(fn(), deadlineController.signal)
      if (predicate(value)) return value
      // oxlint-disable-next-line no-await-in-loop -- keep polling attempts ordered and non-overlapping
      await delay(intervalMs, undefined, { signal: deadlineController.signal })
    }
  } catch (err) {
    if (deadlineController.signal.aborted) throw timeoutError
    throw err
  } finally {
    clearTimeout(timer)
  }
}
