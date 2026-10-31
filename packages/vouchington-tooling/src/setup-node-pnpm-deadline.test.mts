import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/setup-node-pnpm',
)
type Env = Record<string, string | undefined>
const deadline = (await import(join(dir, 'deadline.mjs'))) as {
  parseDeadline: (env: Env, now?: number) => { seconds: number; endMs: number }
  registryHost: (env: Env) => string
  registryUrl: (env: Env) => string
  deadlineMessage: (seconds: number, phase: string, host: string) => string
}
const download = (await import(join(dir, 'download-pnpm.mjs'))) as {
  platformPackage: (platform: string, arch: string, musl: boolean) => string
  isMusl: (report?: unknown) => boolean
  extractFile: (tar: Buffer, name: string) => Buffer
  verifyIntegrity: (bytes: Buffer, integrity: string) => void
  downloadPnpm: (
    env: Env,
    signal: AbortSignal,
    fetchImpl: unknown,
    platform?: string,
  ) => Promise<string>
  main: (env: Env, now: number, fetchImpl: unknown) => Promise<number>
}
const install = (await import(join(dir, 'install.mjs'))) as {
  main: (
    env: Env,
    clock: () => number,
    run: (args: string[], limit: number, grace: number) => Promise<unknown>,
  ) => Promise<number>
  attemptLimitMs: (
    options: { timeoutSeconds: number; graceMs: number },
    deadline: { endMs: number },
    now: number,
  ) => number
  MIN_ATTEMPT_MS: number
}

afterEach(() => vi.restoreAllMocks())

function errors() {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

function tarEntry(name: string, body: Buffer) {
  const header = Buffer.alloc(512)
  header.write(name, 0)
  header.write(body.length.toString(8).padStart(11, '0'), 124)
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length)
  return Buffer.concat([header, body, padding])
}

function archive(files: Record<string, string>) {
  const entries = Object.entries(files).map(([n, b]) => tarEntry(n, Buffer.from(b)))
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]))
}

const integrity = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

describe('deadline helpers', () => {
  it('defaults to 270s from the recorded start, or from now', () => {
    expect(deadline.parseDeadline({ SETUP_NODE_PNPM_STARTED_MS: '1000' }, 5)).toEqual({
      seconds: 270,
      endMs: 271_000,
    })
    expect(deadline.parseDeadline({ SETUP_NODE_PNPM_DEADLINE_SECONDS: ' 60 ' }, 1000)).toEqual({
      seconds: 60,
      endMs: 61_000,
    })
    expect(deadline.parseDeadline({ SETUP_NODE_PNPM_STARTED_MS: 'junk' }, 7).endMs).toBe(270_007)
  })

  it.each(['0', '-1', '1.5', 'abc', '1000000'])('rejects deadline %s', (value) => {
    expect(() => deadline.parseDeadline({ SETUP_NODE_PNPM_DEADLINE_SECONDS: value })).toThrow(
      /deadline-seconds/u,
    )
  })

  it('names the configured registry host, defaulting to registry.npmjs.org', () => {
    expect(deadline.registryHost({})).toBe('registry.npmjs.org')
    expect(deadline.registryHost({ npm_config_registry: 'https://mirror.example:8443/npm/' })).toBe(
      'mirror.example:8443',
    )
    expect(deadline.registryHost({ NPM_CONFIG_REGISTRY: 'https://other.example/' })).toBe(
      'other.example',
    )
    expect(deadline.registryHost({ npm_config_registry: 'not a url' })).toBe('registry.npmjs.org')
    expect(deadline.registryUrl({})).toBe('https://registry.npmjs.org/')
  })

  it('formats one clear line', () => {
    expect(deadline.deadlineMessage(270, 'pnpm install', 'registry.npmjs.org')).toBe(
      'setup-node-pnpm: deadline 270s exceeded during pnpm install (registry.npmjs.org)',
    )
  })
})

describe('install deadline arithmetic', () => {
  const limit = { timeoutSeconds: 150, graceMs: 10_000 }

  it('caps an attempt at the remaining budget minus the kill grace', () => {
    expect(install.attemptLimitMs(limit, { endMs: 1_000_000 }, 0)).toBe(150_000)
    expect(install.attemptLimitMs(limit, { endMs: 100_000 }, 0)).toBe(90_000)
  })

  function harness(startedAt: number, outcomes: Array<{ timedOut: boolean; code: number }>) {
    let now = startedAt
    const calls: Array<[string[], number, number]> = []
    const starts: number[] = []
    const run = (args: string[], limitMs: number, graceMs: number) => {
      calls.push([args, limitMs, graceMs])
      starts.push(now)
      const outcome = outcomes.shift() ?? { timedOut: false, code: 0 }
      now += outcome.timedOut ? limitMs + 1000 : 5000
      return Promise.resolve(outcome)
    }
    return { calls, starts, run, clock: () => now }
  }
  const env = { SETUP_NODE_PNPM_STARTED_MS: '0' }

  it('never lets attempts plus kill grace pass the total deadline', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const err = errors()
    const h = harness(0, [
      { timedOut: true, code: 1 },
      { timedOut: true, code: 1 },
    ])
    expect(
      await install.main({ ...env, SETUP_NODE_PNPM_DEADLINE_SECONDS: '270' }, h.clock, h.run),
    ).toBe(1)
    expect(h.calls.map(([, ms]) => ms)).toEqual([150_000, 109_000])
    h.calls.forEach(([, ms, grace], index) => {
      expect(h.starts[index]! + ms + grace).toBeLessThanOrEqual(270_000)
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('retrying'))
    expect(err).toHaveBeenCalledWith(
      '::error::setup-node-pnpm: deadline 270s exceeded during pnpm install (registry.npmjs.org)',
    )
  })

  it('does not start a retry when under 30s of budget remain', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const err = errors()
    const h = harness(0, [{ timedOut: true, code: 1 }])
    const code = await install.main(
      {
        ...env,
        SETUP_NODE_PNPM_DEADLINE_SECONDS: '180',
        npm_config_registry: 'https://r.example/',
      },
      h.clock,
      h.run,
    )
    expect(code).toBe(1)
    expect(h.calls).toHaveLength(1)
    expect(err).toHaveBeenCalledWith(
      '::error::setup-node-pnpm: deadline 180s exceeded during pnpm install (r.example)',
    )
  })

  it('fails without running pnpm when the download already used the budget', async () => {
    const err = errors()
    const h = harness(0, [])
    const code = await install.main(
      { SETUP_NODE_PNPM_STARTED_MS: '0', SETUP_NODE_PNPM_DEADLINE_SECONDS: '5' },
      () => 4000,
      h.run,
    )
    expect(code).toBe(1)
    expect(h.calls).toEqual([])
    expect(err).toHaveBeenCalledWith(expect.stringContaining('exceeded during pnpm install'))
  })

  it('keeps the give-up message when the per-attempt limit, not the deadline, ended it', async () => {
    const err = errors()
    const h = harness(0, [{ timedOut: true, code: 1 }])
    const code = await install.main({ ...env, INSTALL_ATTEMPTS: '1' }, h.clock, h.run)
    expect(code).toBe(1)
    expect(err).toHaveBeenCalledWith(
      expect.stringMatching(/attempt 1\/1 timed out after 151s; giving up/u),
    )
  })

  it('rejects an invalid deadline before running pnpm', async () => {
    const err = errors()
    const h = harness(0, [])
    expect(await install.main({ SETUP_NODE_PNPM_DEADLINE_SECONDS: '0' }, h.clock, h.run)).toBe(1)
    expect(h.calls).toEqual([])
    expect(err).toHaveBeenCalledWith(expect.stringContaining('deadline-seconds'))
  })

  it('passes a successful exit code through', async () => {
    const h = harness(0, [{ timedOut: false, code: 0 }])
    expect(await install.main(env, h.clock, h.run)).toBe(0)
  })
})

describe('pnpm download', () => {
  const bytes = 'native-binary'
  const tgz = archive({ 'package/LICENSE': 'mit', 'package/pnpm': bytes })
  const base = { PNPM_VERSION: '12.17.0' }

  function registry(overrides: { ok?: boolean; integrity?: string } = {}) {
    const urls: string[] = []
    const fetchImpl = (url: string) => {
      urls.push(url)
      if (overrides.ok === false) return Promise.resolve({ ok: false, status: 503 })
      const body = url.endsWith('.tgz')
        ? tgz
        : Buffer.from(
            JSON.stringify({
              dist: {
                tarball: 'https://registry.npmjs.org/x.tgz',
                integrity: overrides.integrity ?? integrity(tgz),
              },
            }),
          )
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(body) })
    }
    return { fetchImpl, urls }
  }

  it('maps platforms to @pnpm/exe packages', () => {
    expect(download.platformPackage('linux', 'x64', false)).toBe('@pnpm/exe.linux-x64')
    expect(download.platformPackage('linux', 'arm64', true)).toBe('@pnpm/exe.linux-arm64-musl')
    expect(download.platformPackage('darwin', 'arm64', true)).toBe('@pnpm/exe.darwin-arm64')
    expect(download.isMusl({ header: { glibcVersionRuntime: '2.39' } })).toBe(false)
    expect(download.isMusl({ header: {} })).toBe(true)
    expect(typeof download.isMusl()).toBe('boolean')
  })

  it('extracts a named file from a tar and rejects a missing one', () => {
    const tar = Buffer.concat([
      tarEntry('package/a', Buffer.from('A')),
      tarEntry('package/b', Buffer.from('B')),
    ])
    expect(download.extractFile(tar, 'package/b').toString()).toBe('B')
    expect(() => download.extractFile(tar, 'package/c')).toThrow(/not found/u)
    expect(() => download.extractFile(Buffer.alloc(1024), 'package/c')).toThrow(/not found/u)
  })

  it('verifies sha512 integrity', () => {
    const data = Buffer.from('x')
    expect(() => download.verifyIntegrity(data, integrity(data))).not.toThrow()
    expect(() => download.verifyIntegrity(data, 'sha512-AAAA')).toThrow(/integrity/u)
    expect(() => download.verifyIntegrity(data, 'sha1-AAAA')).toThrow(/unsupported/u)
  })

  it('downloads, verifies, writes the binary, and appends its directory to GITHUB_PATH', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dl-'))
    const pathFile = join(tmp, 'path')
    writeFileSync(pathFile, '')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { fetchImpl, urls } = registry()
    const env = {
      ...base,
      RUNNER_TEMP: tmp,
      GITHUB_PATH: pathFile,
      npm_config_registry: 'https://registry.npmjs.org',
    }
    expect(await download.main(env, Date.now(), fetchImpl)).toBe(0)
    const out = join(tmp, 'pnpm-12.17.0')
    expect(readFileSync(join(out, 'pnpm'), 'utf8')).toBe(bytes)
    expect(statSync(join(out, 'pnpm')).mode & 0o111).not.toBe(0)
    expect(readFileSync(pathFile, 'utf8')).toBe(`${out}\n`)
    expect(urls[0]).toMatch(/^https:\/\/registry\.npmjs\.org\/@pnpm%2fexe\.[a-z0-9-]+\/12\.17\.0$/u)
    expect(log).toHaveBeenCalled()
  })

  it('uses pnpm.exe on win32 and works without GITHUB_PATH', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dl-'))
    const exe = archive({ 'package/pnpm.exe': 'win', 'package/pnpm': 'unix' })
    const fetchImpl = (url: string) =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () =>
          Promise.resolve(
            url.endsWith('.tgz')
              ? exe
              : Buffer.from(
                  JSON.stringify({
                    dist: { tarball: 'https://x/x.tgz', integrity: integrity(exe) },
                  }),
                ),
          ),
      })
    const out = await download.downloadPnpm(
      { ...base, RUNNER_TEMP: tmp },
      AbortSignal.timeout(5000),
      fetchImpl,
      'win32',
    )
    expect(existsSync(join(out, 'pnpm.exe'))).toBe(true)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await download.main({ ...base, RUNNER_TEMP: tmp }, Date.now(), fetchImpl)).toBe(0)
  })

  it('fails on a bad integrity, an HTTP error, or a missing version', async () => {
    const err = errors()
    const tmp = mkdtempSync(join(tmpdir(), 'dl-'))
    const env = { ...base, RUNNER_TEMP: tmp }
    expect(
      await download.main(env, Date.now(), registry({ integrity: 'sha512-AAAA' }).fetchImpl),
    ).toBe(1)
    expect(await download.main(env, Date.now(), registry({ ok: false }).fetchImpl)).toBe(1)
    expect(await download.main({ RUNNER_TEMP: tmp }, Date.now(), registry().fetchImpl)).toBe(1)
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('pnpm download failed (registry.npmjs.org)'),
    )
    expect(err).toHaveBeenCalledWith(expect.stringContaining('PNPM_VERSION is not set'))
  })

  it('names the phase and registry host when the deadline expires mid-download', async () => {
    const err = errors()
    const hang = (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    const now = Date.now()
    const env = { ...base, SETUP_NODE_PNPM_STARTED_MS: String(now - 269_950) }
    expect(await download.main(env, now, hang)).toBe(1)
    expect(err).toHaveBeenCalledWith(
      '::error::setup-node-pnpm: deadline 270s exceeded during pnpm download (registry.npmjs.org)',
    )
  })

  it('does not start when no time remains, and rejects an invalid deadline', async () => {
    const err = errors()
    const fetchImpl = vi.fn()
    const env = {
      ...base,
      SETUP_NODE_PNPM_STARTED_MS: '1000',
      SETUP_NODE_PNPM_DEADLINE_SECONDS: '5',
    }
    expect(await download.main(env, 7000, fetchImpl)).toBe(1)
    expect(await download.main({ SETUP_NODE_PNPM_DEADLINE_SECONDS: 'x' }, 7000, fetchImpl)).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('exceeded during pnpm download'))
  })
})
