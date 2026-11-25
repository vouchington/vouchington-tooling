import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/setup-node-pnpm',
)
type Env = Record<string, string | undefined>
const download = (await import(join(dir, 'download-pnpm.mjs'))) as {
  ATTEMPT_TIMEOUT_MS: number
  BACKOFF_MS: number
  IDLE_TIMEOUT_MS: number
  downloadPnpm: (
    env: Env,
    signal: AbortSignal,
    fetchImpl: unknown,
    platform: string | undefined,
    touch: () => void,
  ) => Promise<string>
  main: (
    env: Env,
    now: number,
    fetchImpl: unknown,
    sleep?: (ms: number) => Promise<void>,
  ) => Promise<number>
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const hangsUntilAborted = (_url: string, { signal }: { signal: AbortSignal }) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))

describe('pnpm download stall handling', () => {
  const env = { PNPM_VERSION: '12.0.0', RUNNER_TEMP: mkdtempSync(join(tmpdir(), 'dl-stall-')) }

  it('gives a slow transfer longer than the old flat 30s, a stalled one only the idle window', () => {
    expect(download.ATTEMPT_TIMEOUT_MS).toBeGreaterThan(30_000)
    expect(download.IDLE_TIMEOUT_MS).toBeLessThan(download.ATTEMPT_TIMEOUT_MS)
  })

  it('aborts a stalled attempt after the idle window and backs off 5s then 10s', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const waits: number[] = []
    const sleep = async (ms: number) => {
      waits.push(ms)
    }
    const fetchImpl = vi.fn(hangsUntilAborted)
    const done = download.main(env, Date.now(), fetchImpl, sleep)
    await vi.advanceTimersByTimeAsync(download.IDLE_TIMEOUT_MS * 3 + 1000)
    expect(await done).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([download.BACKOFF_MS, download.BACKOFF_MS * 2])
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('attempt 3/3 failed (registry.npmjs.org): no data received for 15s'),
    )
  })

  it('stops an attempt that keeps trickling data at the attempt cap', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchImpl = vi.fn(async (_url: string, { signal }: { signal: AbortSignal }) => ({
      ok: true,
      body: (async function* () {
        for (;;) {
          await new Promise((resolveChunk, reject) => {
            const timer = setTimeout(resolveChunk, 5000)
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              reject(signal.reason)
            })
          })
          yield Buffer.from('{')
        }
      })(),
    }))
    const done = download.main(env, Date.now(), fetchImpl, async () => undefined)
    await vi.advanceTimersByTimeAsync(download.ATTEMPT_TIMEOUT_MS * 3 + 1000)
    expect(await done).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('no download within 60s'))
  })

  it('treats the response and every body chunk as progress', async () => {
    const touch = vi.fn()
    const body = (...parts: string[]) =>
      (async function* () {
        for (const part of parts) yield Buffer.from(part)
      })()
    const fetchImpl = async (url: string) => ({
      ok: true,
      body: url.endsWith('.tgz')
        ? body('abc', 'def')
        : body('{"dist":{"tarball":"https://x/a.tgz",', '"integrity":"sha512-AAAA"}}'),
    })
    await expect(
      download.downloadPnpm(env, AbortSignal.timeout(5000), fetchImpl, 'linux', touch),
    ).rejects.toThrow(/integrity/u)
    expect(touch).toHaveBeenCalledTimes(6)
  })
})
