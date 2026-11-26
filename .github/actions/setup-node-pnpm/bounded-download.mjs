// Bounded download and retry loop shared by the pnpm and Node downloads. The Node
// download runs on the runner's system Node before setup-node (as old as Node 20), so use
// nothing newer than Node 20. No dependencies.
import { deadlineMessage, parseDeadline, registryHost } from './deadline.mjs'

// `touch` runs on the response and on every body chunk, so the caller can tell a stalled
// connection from a slow one that is still making progress.
export async function getBuffer(url, signal, fetchImpl, touch) {
  const response = await fetchImpl(url, { signal })
  touch()
  if (!response.ok) {
    throw Object.assign(new Error(`${url} responded ${response.status}`), {
      status: response.status,
    })
  }
  if (!response.body) return Buffer.from(await response.arrayBuffer())
  const chunks = []
  for await (const chunk of response.body) {
    chunks.push(chunk)
    touch()
  }
  return Buffer.concat(chunks)
}

/** @public Imported by the tests. */
export const ATTEMPTS = 3
// Each attempt fails after IDLE_TIMEOUT_MS without a byte (a stall) or ATTEMPT_TIMEOUT_MS in all
// (a trickle), whichever comes first, and never runs past the total deadline. The ~30 MB tarball
// can therefore take longer than a flat 30s when the runner is slow but still receiving data.
/** @public */
export const ATTEMPT_TIMEOUT_MS = 60_000
/** @public */
export const IDLE_TIMEOUT_MS = 15_000
// The wait before retry N is N times this, so a registry blip has 5s, then 10s, to clear.
/** @public */
export const BACKOFF_MS = 5_000

const NETWORK_CODES =
  /^(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ESOCKETTIMEDOUT|UND_ERR_\w+)$/u

// Why a failed attempt is worth another one, or undefined when it is not: a per-attempt timeout,
// a dropped connection, or a 408/429/5xx response. A 404 or an integrity failure is final.
/** @public */
export function transientReason(error) {
  if (error?.name === 'TimeoutError') return 'per-attempt timeout'
  const status = error?.status
  if (status === 408 || status === 429 || status >= 500) return `HTTP ${status}`
  const code = error?.cause?.code ?? error?.code
  return error instanceof TypeError || NETWORK_CODES.test(code ?? '')
    ? `network error ${code ?? error.message}`
    : undefined
}

// Resolves after `ms`, or earlier when `signal` aborts. The timer is cleared on abort.
const pause = (ms, signal) =>
  new Promise((done) => {
    const timer = setTimeout(done, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        done()
      },
      { once: true },
    )
  })

// Runs `task(signal, touch)` up to ATTEMPTS times under the shared deadline, retrying only a
// transient failure. Returns the process exit code; `task` logs its own success.
export async function retryDownload(
  label,
  task,
  env = process.env,
  now = Date.now(),
  sleep = pause,
  backoffMs = BACKOFF_MS,
  host = registryHost(env),
) {
  let deadline
  try {
    deadline = parseDeadline(env, now)
  } catch (error) {
    console.error(`::error::${error.message}`)
    return 1
  }
  const fail = () => {
    console.error(`::error::${deadlineMessage(deadline.seconds, label, host)}`)
    return 1
  }
  const total = AbortSignal.timeout(Math.max(deadline.endMs - now, 0))
  if (deadline.endMs - now <= 0) return fail()
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const attemptAbort = new AbortController()
    const abortAfter = (ms, why) =>
      setTimeout(() => attemptAbort.abort(new DOMException(why, 'TimeoutError')), ms)
    const cap = abortAfter(ATTEMPT_TIMEOUT_MS, `no download within ${ATTEMPT_TIMEOUT_MS / 1000}s`)
    let idle
    const touch = () => {
      clearTimeout(idle)
      idle = abortAfter(IDLE_TIMEOUT_MS, `no data received for ${IDLE_TIMEOUT_MS / 1000}s`)
    }
    touch()
    const signal = AbortSignal.any([total, attemptAbort.signal])
    try {
      await task(signal, touch)
      return 0
    } catch (error) {
      if (total.aborted) return fail()
      const wait = backoffMs * attempt
      const reason = transientReason(error)
      const note = `${label} attempt ${attempt}/${ATTEMPTS} failed (${host}): ${error.message}`
      if (reason === undefined || attempt === ATTEMPTS) {
        console.error(`::error::setup-node-pnpm: ${note}`)
        return 1
      }
      console.log(`::warning::setup-node-pnpm: ${note}; ${reason}, retrying in ${wait / 1000}s`)
      await sleep(wait, total)
      if (total.aborted) return fail()
    } finally {
      clearTimeout(cap)
      clearTimeout(idle)
    }
  }
  return 1
}
