// Downloads the resolved pnpm release's native binary from the npm registry under the shared
// deadline and puts it on GITHUB_PATH. Node >= 24, no dependencies.
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { deadlineMessage, parseDeadline, registryHost, registryUrl } from './deadline.mjs'

export function platformPackage(platform, arch, musl) {
  return `@pnpm/exe.${platform}-${arch}${platform === 'linux' && musl ? '-musl' : ''}`
}

export function isMusl(report = process.report?.getReport?.()) {
  return !report?.header?.glibcVersionRuntime
}

// Returns the bytes of the first regular file named `wanted` in a tar archive.
export function extractFile(tar, wanted) {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.toString('utf8', offset, offset + 100).replace(/\0.*$/su, '')
    if (name === '') break
    const size = Number.parseInt(tar.toString('utf8', offset + 124, offset + 136), 8)
    const data = offset + 512
    if (name === wanted) return tar.subarray(data, data + size)
    offset = data + Math.ceil(size / 512) * 512
  }
  throw new Error(`${wanted} not found in the pnpm package`)
}

export function verifyIntegrity(bytes, integrity) {
  const [algorithm, expected] = String(integrity).split('-')
  if (algorithm !== 'sha512') throw new Error(`unsupported integrity "${integrity}"`)
  if (createHash('sha512').update(bytes).digest('base64') !== expected) {
    throw new Error('downloaded pnpm package failed its integrity check')
  }
}

// `touch` runs on the response and on every body chunk, so the caller can tell a stalled
// connection from a slow one that is still making progress.
async function getBuffer(url, signal, fetchImpl, touch) {
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

export async function downloadPnpm(
  env,
  signal,
  fetchImpl,
  platform = process.platform,
  touch = () => {},
) {
  const version = (env.PNPM_VERSION ?? '').trim()
  if (version === '') throw new Error('PNPM_VERSION is not set')
  const base = registryUrl(env).replace(/\/?$/u, '/')
  const name = platformPackage(platform, process.arch, platform === 'linux' && isMusl())
  const url = `${base}${name.replace('/', '%2f')}/${version}`
  const meta = JSON.parse((await getBuffer(url, signal, fetchImpl, touch)).toString('utf8'))
  const archive = await getBuffer(meta.dist.tarball, signal, fetchImpl, touch)
  verifyIntegrity(archive, meta.dist.integrity)
  const binary = platform === 'win32' ? 'pnpm.exe' : 'pnpm'
  const dir = join(env.RUNNER_TEMP || tmpdir(), `pnpm-${version}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, binary), extractFile(gunzipSync(archive), `package/${binary}`))
  chmodSync(join(dir, binary), 0o755)
  return dir
}

export const ATTEMPTS = 3
// Each attempt fails after IDLE_TIMEOUT_MS without a byte (a stall) or ATTEMPT_TIMEOUT_MS in all
// (a trickle), whichever comes first, and never runs past the total deadline. The ~30 MB tarball
// can therefore take longer than a flat 30s when the runner is slow but still receiving data.
export const ATTEMPT_TIMEOUT_MS = 60_000
export const IDLE_TIMEOUT_MS = 15_000
// The wait before retry N is N times this, so a registry blip has 5s, then 10s, to clear.
export const BACKOFF_MS = 5_000

const NETWORK_CODES =
  /^(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ESOCKETTIMEDOUT|UND_ERR_\w+)$/u

// Why a failed attempt is worth another one, or undefined when it is not: a per-attempt timeout,
// a dropped connection, or a 408/429/5xx response. A 404 or an integrity failure is final.
export function transientReason(error) {
  if (error?.name === 'TimeoutError') return 'per-attempt timeout'
  const status = error?.status
  if (status === 408 || status === 429 || status >= 500) return `HTTP ${status}`
  const code = error?.cause?.code ?? error?.code
  return error instanceof TypeError || NETWORK_CODES.test(code ?? '')
    ? `network error ${code ?? error.message}`
    : undefined
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms))

export async function main(
  env = process.env,
  now = Date.now(),
  fetchImpl = fetch,
  sleep = pause,
  backoffMs = BACKOFF_MS,
) {
  let deadline
  try {
    deadline = parseDeadline(env, now)
  } catch (error) {
    console.error(`::error::${error.message}`)
    return 1
  }
  const host = registryHost(env)
  const fail = () => {
    console.error(`::error::${deadlineMessage(deadline.seconds, 'pnpm download', host)}`)
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
      const dir = await downloadPnpm(env, signal, fetchImpl, undefined, touch)
      if (env.GITHUB_PATH) appendFileSync(env.GITHUB_PATH, `${dir}\n`)
      console.log(`Installed pnpm ${env.PNPM_VERSION} to ${dir}`)
      return 0
    } catch (error) {
      if (total.aborted) return fail()
      const wait = backoffMs * attempt
      const reason = transientReason(error)
      const note = `pnpm download attempt ${attempt}/${ATTEMPTS} failed (${host}): ${error.message}`
      if (reason === undefined || attempt === ATTEMPTS) {
        console.error(`::error::setup-node-pnpm: ${note}`)
        return 1
      }
      console.log(`::warning::setup-node-pnpm: ${note}; ${reason}, retrying in ${wait / 1000}s`)
      await sleep(wait)
    } finally {
      clearTimeout(cap)
      clearTimeout(idle)
    }
  }
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main()
