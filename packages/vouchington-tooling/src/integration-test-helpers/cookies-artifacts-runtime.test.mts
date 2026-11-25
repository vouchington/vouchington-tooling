import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupManagedServices,
  closeWebApiClientRuntime,
  createAssetMetadataCache,
  createLoopbackClientFetch,
  ensureRequiredPathsExist,
  printTrace,
  startReservedProcess,
  WebIntegrationCookies,
  withWebApiClientRuntime,
  writePageArtifact,
  type ManagedProcess,
} from './index.mts'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'integration-helpers-misc-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('WebIntegrationCookies, artifacts, trace printing, and asset cache', () => {
  it('captures, sets, deletes, clears, and formats cookies including combined set-cookie fallback', () => {
    const jar = new WebIntegrationCookies()
    const res = new Response(null)
    res.headers.append('set-cookie', 'a=1; Path=/; HttpOnly')
    res.headers.append('set-cookie', 'b=2; Path=/')
    res.headers.append('set-cookie', 'malformed-without-equals')
    jar.captureSetCookies(res)
    expect(jar.get('a')).toBe('1')
    expect(jar.get('b')).toBe('2')
    expect(jar.toHeader()).toBe('a=1; b=2')

    // Clearing cookie via empty value + fallback parser when getSetCookie is absent.
    const fakeResponse = {
      headers: {
        get: (name: string) =>
          name === 'set-cookie' ? 'a=; Path=/, c=3; Expires=Wed, 21 Oct 2026 07:28:00 GMT, ' : null,
      },
    } as unknown as Response
    jar.captureSetCookies(fakeResponse)
    expect(jar.get('a')).toBeUndefined()
    expect(jar.get('c')).toBe('3')

    const emptyHeaderRes = {
      headers: { get: () => null },
    } as unknown as Response
    jar.captureSetCookies(emptyHeaderRes)

    jar.set('d', '4')
    expect(jar.get('d')).toBe('4')
    jar.clear()
    expect(jar.toHeader()).toBe('')
  })

  it('writes sanitized page artifacts and prints verbose traces', async () => {
    const dir = makeTempDir()
    await writePageArtifact(dir, '/home/page?x=1!', { ok: true })
    expect(JSON.parse(readFileSync(join(dir, 'home-page-x-1.json'), 'utf8'))).toEqual({
      ok: true,
    })

    const out: string[] = []
    printTrace('/quiet', [], { verbose: false, write: (c) => out.push(c) })
    expect(out).toEqual([])

    printTrace('/empty', [], { verbose: true, label: '[test]', write: (c) => out.push(c) })
    printTrace(
      '/items',
      [
        {
          method: 'GET',
          path: '/api/items',
          status: 200,
          durationMs: 12,
          cookieHeader: null,
          userAgent: null,
          requestId: 'r1',
        },
      ],
      { verbose: true, write: (c) => out.push(c) },
    )
    expect(out.join('')).toContain('[test] API trace for /empty')
    expect(out.join('')).toContain('(no backend requests)')
    expect(out.join('')).toContain('[web-integration] API trace for /items')
    expect(out.join('')).toContain('GET /api/items -> 200 (12ms)')

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.stubEnv('WEB_INTEGRATION_VERBOSE', '1')
    printTrace('/env', [])
    expect(stdoutSpy).toHaveBeenCalledOnce()
  })

  it('caches static asset metadata, collapses concurrent fetches, evicts failures, and skips mutable paths', async () => {
    expect(() => createAssetMetadataCache({})).toThrow('requires either traceOrigin or limiter')

    const fetchCached = createAssetMetadataCache({
      limiter: async (fn) => fn(),
    })

    let resolveAsset!: (res: Response) => void
    const fetchAsset = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveAsset = resolve
        }),
    )
    const p1 = fetchCached('/_next/static/chunk.js', fetchAsset)
    const p2 = fetchCached('/_next/static/chunk.js', fetchAsset)
    resolveAsset(new Response('js', { headers: { 'content-type': 'application/javascript' } }))
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      { status: 200, contentType: 'application/javascript' },
      { status: 200, contentType: 'application/javascript' },
    ])
    expect(fetchAsset).toHaveBeenCalledTimes(1)

    // Evicts rejections and >=400 responses.
    const flaky = vi
      .fn<(url: string) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce(new Response('err', { status: 502 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    await expect(fetchCached('/_next/static/flaky.js', flaky)).rejects.toThrow('net')
    await expect(fetchCached('/_next/static/flaky.js', flaky)).resolves.toMatchObject({
      status: 502,
    })
    await expect(fetchCached('/_next/static/flaky.js', flaky)).resolves.toMatchObject({
      status: 200,
    })
    expect(flaky).toHaveBeenCalledTimes(3)

    // Mutable paths are not cached.
    const mutable = vi.fn(async () => new Response('ok'))
    await fetchCached('/robots.txt', mutable)
    await fetchCached('/robots.txt', mutable)
    expect(mutable).toHaveBeenCalledTimes(2)

    // traceOrigin constructor path initializes the cross-process limiter cleanly.
    const withOrigin = createAssetMetadataCache({ traceOrigin: 'http://127.0.0.1:9' })
    expect(typeof withOrigin).toBe('function')
  })
})

describe('setup, cleanup, and web-api client runtime helpers', () => {
  it('checks required paths, starts reserved processes, and cleans up services and files', async () => {
    const dir = makeTempDir()
    const existingFile = join(dir, 'exists.txt')
    const missingFile = join(dir, 'missing.txt')
    writeFileSync(existingFile, 'before')

    expect(() =>
      ensureRequiredPathsExist([{ label: 'Existing', path: existingFile }]),
    ).not.toThrow()
    expect(() =>
      ensureRequiredPathsExist([{ label: 'Missing', path: missingFile }], {
        prefix: '[custom]',
        hint: 'Run build first.',
      }),
    ).toThrow('[custom] Missing required build artifacts.\nMissing:')
    expect(() => ensureRequiredPathsExist([{ label: 'Missing', path: missingFile }])).toThrow(
      '[integration] Missing required build artifacts.',
    )

    const events: string[] = []
    const reservation = {
      port: 4046,
      release: async () => void events.push('release-port'),
    }
    const processes: ManagedProcess[] = []
    const proc = await startReservedProcess(reservation, processes, {
      name: 'echo',
      command: process.execPath,
      args: ['-e', 'console.log("hi")'],
      cwd: dir,
      logFilePrefix: 'echo',
      logsDir: dir,
      writeStdout: () => {},
      writeStderr: () => {},
    })
    await proc.exited
    expect(processes).toHaveLength(1)
    expect(events).toEqual(['release-port'])

    const createdFile = join(dir, 'created.vars')
    writeFileSync(createdFile, 'temp')
    writeFileSync(existingFile, 'mutated')
    const closedProxy = vi.fn(async () => undefined)
    await cleanupManagedServices({
      processes,
      reservedPorts: [reservation],
      closeables: [{ close: closedProxy }],
      filesToRestore: [
        { path: existingFile, existingContent: 'before' },
        { path: createdFile, existingContent: null },
      ],
    })
    expect(closedProxy).toHaveBeenCalledOnce()
    expect(readFileSync(existingFile, 'utf8')).toBe('before')
    expect(existsSync(createdFile)).toBe(false)

    // Defaults for optional closeables and filesToRestore.
    await cleanupManagedServices({ processes: [], reservedPorts: [] })
  })

  it('manages loopback client fetch interception and runtime teardown', async () => {
    let active = false
    let cookie: string | undefined
    const previousFetch = vi.fn<typeof globalThis.fetch>(async () => new Response('ok'))

    const alwaysFetch = createLoopbackClientFetch({
      baseUrl: 'http://127.0.0.1:4046',
      previousFetch,
      isActive: () => active,
      getCookie: () => cookie,
      buildHeaders: (init) => {
        const h = new Headers(init)
        h.set('x-proxy', '1')
        return h
      },
      extraHeader: { name: 'X-Secret', value: 's1' },
    })

    // Inactive or non-relative URLs pass through unchanged.
    await alwaysFetch('/api/test')
    expect(previousFetch).toHaveBeenLastCalledWith('/api/test', undefined)

    await withWebApiClientRuntime({
      cookieHeader: { Cookie: 'sid=abc' },
      setActive: (nextActive, nextCookie) => {
        active = nextActive
        cookie = nextCookie
      },
      run: async () => {
        expect(Reflect.get(globalThis, 'window')).toEqual({})
        await alwaysFetch('https://external.example/x')
        expect(previousFetch).toHaveBeenLastCalledWith('https://external.example/x', undefined)

        await alwaysFetch('/api/items', { method: 'POST' })
        const [calledUrl, calledInit] = previousFetch.mock.calls.at(-1)!
        expect(calledUrl).toBe('http://127.0.0.1:4046/api/items')
        const headers = calledInit?.headers as Headers
        expect(headers.get('x-proxy')).toBe('1')
        expect(headers.get('x-secret')).toBe('s1')
        expect(headers.get('cookie')).toBe('sid=abc')
        expect(headers.get('origin')).toBe('http://127.0.0.1:4046')

        // GET does not set Origin.
        await alwaysFetch('/api/items')
        const getHeaders = previousFetch.mock.calls.at(-1)![1]?.headers as Headers
        expect(getHeaders.get('origin')).toBeNull()
      },
    })
    expect(active).toBe(false)
    expect(cookie).toBeUndefined()

    // with-cookie mode and default buildHeaders.
    const withCookieFetch = createLoopbackClientFetch({
      baseUrl: 'http://127.0.0.1:4046',
      previousFetch,
      isActive: () => true,
      getCookie: () => cookie,
      extraHeader: { name: 'X-Secret', value: 's2', mode: 'with-cookie' },
    })
    await withCookieFetch('/api/anon')
    expect(new Headers(previousFetch.mock.calls.at(-1)![1]?.headers).get('x-secret')).toBeNull()
    cookie = 'sid=xyz'
    await withCookieFetch('/api/authed')
    expect(new Headers(previousFetch.mock.calls.at(-1)![1]?.headers).get('x-secret')).toBe('s2')

    const originalFetch = globalThis.fetch
    const closed = vi.fn()
    globalThis.fetch = alwaysFetch
    await closeWebApiClientRuntime({
      backendServer: {
        close: (cb) => {
          closed()
          cb()
        },
      },
      previousFetch: originalFetch,
    })
    expect(closed).toHaveBeenCalledOnce()
    expect(globalThis.fetch).toBe(originalFetch)
  })
})
