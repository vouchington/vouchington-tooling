/** How long the final reading after the deadline may take before the wait gives up. */
const FINAL_READING_GRACE_MS = 250

async function within<T>(reading: Promise<T>, ms: number, timeoutError: Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), ms)
  })
  try {
    return await Promise.race([reading, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Polls `fn` until it returns a non-null value, then returns it. Throws once `maxMs` elapses, even
 * when a reading never settles, so a value that never appears fails at the wait instead of letting
 * a later assertion pass vacuously.
 */
export async function pollUntilNotNull<T>(
  fn: () => Promise<T | null | undefined>,
  maxMs = 2000,
  intervalMs = 25,
  description = 'a non-null value',
): Promise<T> {
  const timeoutError = new Error(`Timed out waiting for ${description} (after ${maxMs}ms)`)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const result = await within(fn(), Math.max(deadline - Date.now(), 1), timeoutError)
    if (result != null) return result
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  const last = await within(fn(), FINAL_READING_GRACE_MS, timeoutError)
  if (last != null) return last
  throw timeoutError
}
