import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  '.github/actions/setup-node-pnpm',
)
type Env = Record<string, string | undefined>
const node = (await import(join(dir, 'download-node.mjs'))) as {
  parseSpec: (text: string) => number[] | undefined
  satisfies: (version: string, spec: number[]) => boolean
  cachedVersion: (toolcache: string, arch: string, spec: number[]) => string | undefined
  resolveVersion: (index: { version: string }[], spec: number[]) => string
  main: (
    env: Env,
    now: number,
    fetchImpl: unknown,
    sleep?: (ms: number) => Promise<void>,
    backoffMs?: number,
    platform?: string,
    arch?: string,
  ) => Promise<number>
}
const bounds = (await import(join(dir, 'bounded-download.mjs'))) as {
  BACKOFF_MS: number
  IDLE_TIMEOUT_MS: number
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const temp = () => mkdtempSync(join(tmpdir(), 'dl-node-'))
const quiet = () => ({
  log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
  err: vi.spyOn(console, 'error').mockImplementation(() => undefined),
})

function release(version: string, platform = 'linux', arch = 'x64') {
  const root = temp()
  const top = `node-v${version}-${platform}-${arch}`
  mkdirSync(join(root, top, 'bin'), { recursive: true })
  writeFileSync(join(root, top, 'bin', 'node'), 'node-binary')
  const name = `${top}.tar.gz`
  execFileSync('tar', ['-czf', join(root, name), '-C', root, top])
  const archive = readFileSync(join(root, name))
  const sha = createHash('sha256').update(archive).digest('hex')
  return { name, archive, sums: `${sha}  ${name}\n` }
}

function workspace(versionFile?: string) {
  const root = temp()
  if (versionFile !== undefined) writeFileSync(join(root, '.nvmrc'), versionFile)
  return { GITHUB_WORKSPACE: root, RUNNER_TOOL_CACHE: join(root, 'cache') }
}

const respond = (body: string | Buffer) => ({ ok: true, body: [Buffer.from(body)] })

function dist(version: string, extra: Record<string, unknown> = {}) {
  const { name, archive, sums } = release(version)
  const fetchImpl = vi.fn(async (url: string) => {
    if (url.endsWith('index.json')) {
      return respond(JSON.stringify([{ version: 'v25.0.0' }, { version: `v${version}` }]))
    }
    if (url.endsWith('SHASUMS256.txt')) return respond((extra.sums as string | undefined) ?? sums)
    if (url.endsWith(name)) return respond(archive)
    return { ok: false, status: 404 }
  })
  return fetchImpl
}

describe('version selection', () => {
  it('reads plain version numbers and leaves everything else to setup-node', () => {
    expect(node.parseSpec('24\n')).toEqual([24])
    expect(node.parseSpec('v24.1')).toEqual([24, 1])
    expect(node.parseSpec('24.1.2')).toEqual([24, 1, 2])
    expect(node.parseSpec('lts/*')).toBeUndefined()
    expect(node.parseSpec('>=24')).toBeUndefined()
  })

  it('matches by prefix and picks the newest release from the index', () => {
    expect(node.satisfies('24.1.2', [24])).toBe(true)
    expect(node.satisfies('24.1.2', [24, 2])).toBe(false)
    expect(node.satisfies('24.1.2', [24, 1, 2])).toBe(true)
    expect(node.satisfies('24.0.0-rc.1', [24])).toBe(false)
    const index = [{ version: 'v25.1.0' }, { version: 'v24.9.0' }, { version: 'v24.1.0' }]
    expect(node.resolveVersion(index, [24])).toBe('24.9.0')
    expect(() => node.resolveVersion(index, [23])).toThrow(/no Node.js release matches 23/u)
  })

  it('counts only a completed toolcache entry for the architecture', () => {
    const cache = temp()
    expect(node.cachedVersion(cache, 'x64', [24])).toBeUndefined()
    mkdirSync(join(cache, 'node', '24.0.1', 'x64'), { recursive: true })
    expect(node.cachedVersion(cache, 'x64', [24])).toBeUndefined()
    writeFileSync(join(cache, 'node', '24.0.1', 'x64.complete'), '')
    expect(node.cachedVersion(cache, 'x64', [24])).toBe('24.0.1')
    expect(node.cachedVersion(cache, 'arm64', [24])).toBeUndefined()
    expect(node.cachedVersion(cache, 'x64', [22])).toBeUndefined()
  })
})

describe('node download', () => {
  it('leaves Node to setup-node without a toolcache, a plain version, a posix platform or a file', async () => {
    const { log } = quiet()
    const fetchImpl = vi.fn()
    const ok = workspace('24\n')
    expect(await node.main({ ...ok, RUNNER_TOOL_CACHE: undefined }, 0, fetchImpl)).toBe(0)
    expect(await node.main(workspace('lts/*'), 0, fetchImpl)).toBe(0)
    expect(await node.main(workspace(), 0, fetchImpl)).toBe(0)
    expect(await node.main(ok, 0, fetchImpl, undefined, undefined, 'win32')).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Node.js version is left to actions/setup-node')
  })

  it('downloads nothing when the toolcache already has the version', async () => {
    const { log } = quiet()
    const env = workspace('24')
    mkdirSync(join(env.RUNNER_TOOL_CACHE, 'node', '24.3.0'), { recursive: true })
    writeFileSync(join(env.RUNNER_TOOL_CACHE, 'node', '24.3.0', `${process.arch}.complete`), '')
    const fetchImpl = vi.fn()
    expect(await node.main(env, Date.now(), fetchImpl)).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Node.js 24.3.0 is already in the toolcache')
  })

  it('resolves a major from the index and installs it where setup-node looks', async () => {
    quiet()
    const env = workspace('24')
    expect(
      await node.main(env, Date.now(), dist('24.2.0'), undefined, undefined, 'linux', 'x64'),
    ).toBe(0)
    const installed = join(env.RUNNER_TOOL_CACHE, 'node', '24.2.0', 'x64')
    expect(readFileSync(join(installed, 'bin', 'node'), 'utf8')).toBe('node-binary')
    expect(existsSync(`${installed}.complete`)).toBe(true)
  })

  it('installs an exact version without reading the index', async () => {
    quiet()
    const env = workspace('v24.2.0')
    const fetchImpl = dist('24.2.0')
    expect(await node.main(env, Date.now(), fetchImpl, undefined, undefined, 'linux', 'x64')).toBe(
      0,
    )
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.stringContaining('index.json'),
      expect.anything(),
    )
  })

  it('fails on a missing or mismatched checksum without retrying', async () => {
    const { err } = quiet()
    const sleep = vi.fn(async () => undefined)
    const wrong = `${'0'.repeat(64)}  node-v24.2.0-linux-x64.tar.gz\n`
    const mismatch = dist('24.2.0', { sums: wrong })
    expect(
      await node.main(workspace('24.2.0'), Date.now(), mismatch, sleep, 1, 'linux', 'x64'),
    ).toBe(1)
    const unlisted = dist('24.2.0', { sums: 'abc  other.tar.gz\n' })
    expect(
      await node.main(workspace('24.2.0'), Date.now(), unlisted, sleep, 1, 'linux', 'x64'),
    ).toBe(1)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('failed its sha256 check'))
    expect(err).toHaveBeenCalledWith(expect.stringContaining('not listed in SHASUMS256.txt'))
    expect(sleep).not.toHaveBeenCalled()
  })

  it('fails fast and retries a stalled download instead of waiting for the action timeout', async () => {
    vi.useFakeTimers()
    const { err } = quiet()
    const waits: number[] = []
    const sleep = async (ms: number) => {
      waits.push(ms)
    }
    const hang = vi.fn(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    )
    const done = node.main(workspace('24'), Date.now(), hang, sleep, undefined, 'linux', 'x64')
    await vi.advanceTimersByTimeAsync(bounds.IDLE_TIMEOUT_MS * 3 + 1000)
    expect(await done).toBe(1)
    expect(hang).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([bounds.BACKOFF_MS, bounds.BACKOFF_MS * 2])
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('node download attempt 3/3 failed (nodejs.org): no data received'),
    )
  })

  it('stops waiting to retry as soon as the shared deadline expires', async () => {
    const { err } = quiet()
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }))
    const env = { ...workspace('24'), SETUP_NODE_PNPM_DEADLINE_SECONDS: '1' }
    const started = Date.now()
    expect(await node.main(env, started, fetchImpl, undefined, undefined, 'linux', 'x64')).toBe(1)
    expect(Date.now() - started).toBeLessThan(bounds.BACKOFF_MS)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('deadline 1s exceeded'))
  })

  it('fails on a deadline that has already passed without downloading', async () => {
    const { err } = quiet()
    const fetchImpl = vi.fn()
    const env = {
      ...workspace('24'),
      SETUP_NODE_PNPM_DEADLINE_SECONDS: '1',
      SETUP_NODE_PNPM_STARTED_MS: '1',
    }
    expect(await node.main(env, 5000, fetchImpl, undefined, undefined, 'linux', 'x64')).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('nodejs.org'))
  })
})
