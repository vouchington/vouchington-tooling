import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/setup-node-pnpm',
)
const { networkFailureReason } = (await import(join(dir, 'network-errors.mjs'))) as {
  networkFailureReason: (output: string) => string | undefined
}
const bounded = (await import(join(dir, 'bounded-download.mjs'))) as {
  ATTEMPTS: number
  transientReason: (error: unknown) => string | undefined
}
const download = (await import(join(dir, 'download-pnpm.mjs'))) as {
  main: (
    env: Record<string, string>,
    now: number,
    fetchImpl: () => Promise<unknown>,
    sleep: (ms: number) => Promise<void>,
    backoffMs: number,
  ) => Promise<number>
}

afterEach(() => vi.restoreAllMocks())

describe('network failure classification', () => {
  it.each([
    ['ERR_PNPM_META_FETCH_FAIL GET https://registry.npmjs.org/x: boom', 'ERR_PNPM_META_FETCH_FAIL'],
    ['ERR_PNPM_FETCH_503 GET x: Service Unavailable', 'ERR_PNPM_FETCH_503'],
    ['ERR_PNPM_FETCH_429 too many', 'ERR_PNPM_FETCH_429'],
    ['request failed: ETIMEDOUT', 'ETIMEDOUT'],
    ['read ECONNRESET', 'ECONNRESET'],
    ['getaddrinfo EAI_AGAIN registry.npmjs.org', 'EAI_AGAIN'],
    ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT'],
    ['socket hang up', 'socket hang up'],
  ])('retries %s', (output, reason) => {
    expect(networkFailureReason(output)).toBe(reason)
  })

  it.each([
    'ERR_PNPM_FETCH_404 GET x: Not Found - 404',
    'ERR_PNPM_META_FETCH_FAIL wrapping ERR_PNPM_FETCH_404',
    'ERR_PNPM_OUTDATED_LOCKFILE ECONNRESET in a log',
    'ERR_PNPM_TARBALL_INTEGRITY ETIMEDOUT',
    'ELIFECYCLE postinstall ECONNRESET',
    'some other failure',
    '',
  ])('fails at once on %s', (output) => {
    expect(networkFailureReason(output)).toBeUndefined()
  })
})

describe('pnpm download retries', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dl-retry-'))
  const env = { PNPM_VERSION: '12.0.0', RUNNER_TEMP: tmp }
  const noSleep = async () => {}

  it('classifies transient and final errors', () => {
    expect(bounded.transientReason(new DOMException('t', 'TimeoutError'))).toBe(
      'per-attempt timeout',
    )
    expect(bounded.transientReason(Object.assign(new Error('x'), { status: 503 }))).toBe('HTTP 503')
    expect(bounded.transientReason(Object.assign(new Error('x'), { status: 429 }))).toBe('HTTP 429')
    expect(bounded.transientReason(Object.assign(new Error('x'), { status: 404 }))).toBeUndefined()
    expect(bounded.transientReason(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(
      'network error ECONNRESET',
    )
    expect(bounded.transientReason(new TypeError('fetch failed'))).toBe(
      'network error fetch failed',
    )
    expect(bounded.transientReason(new Error('integrity'))).toBeUndefined()
    expect(bounded.transientReason(undefined)).toBeUndefined()
  })

  it('retries a network failure with a logged reason, then gives up after 3 attempts', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await download.main(env, Date.now(), fetchImpl, noSleep, 3000)).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(bounded.ATTEMPTS)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        'attempt 1/3 failed (registry.npmjs.org): fetch failed; network error fetch failed, retrying in 3s',
      ),
    )
    expect(err).toHaveBeenCalledWith(expect.stringContaining('attempt 3/3 failed'))
  })

  it('does not retry a 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }))
    expect(await download.main(env, Date.now(), fetchImpl, noSleep, 1)).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reports the deadline, not a retry, when the total budget runs out mid-attempt', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new DOMException('aborted', 'TimeoutError')), 100),
        ),
    )
    const started = String(Date.now() - 269_950)
    const code = await download.main(
      { ...env, SETUP_NODE_PNPM_STARTED_MS: started },
      Date.now(),
      fetchImpl,
      noSleep,
      1,
    )
    expect(code).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('exceeded during pnpm download'))
  })
})
