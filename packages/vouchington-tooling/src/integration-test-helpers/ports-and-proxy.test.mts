import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allocateReservedPorts,
  buildUpstreamHeaders,
  createAssetConcurrencyBroker,
  createCrossProcessConcurrencyLimiter,
  createTraceProxy,
  FETCH_FORBIDDEN_PORTS,
  isFetchForbiddenPort,
  isFetchSafePort,
  listenOnFetchSafeEphemeralPort,
  listenOnFetchSafeLoopback,
  readKernelEphemeralPortRange,
  reserveLoopbackPorts,
  servicePortBand,
} from './index.mts'

const cleanups: Array<() => Promise<void>> = []

function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup().catch(() => undefined)
  }
})

describe('ports helpers', () => {
  it('matches scripts/fetch-forbidden-ports.json and validates port ranges and bands', () => {
    const shipped = JSON.parse(
      readFileSync(new URL('../../scripts/fetch-forbidden-ports.json', import.meta.url), 'utf8'),
    ) as number[]
    expect([...FETCH_FORBIDDEN_PORTS]).toEqual(shipped)
    expect(isFetchForbiddenPort(4045)).toBe(true)
    expect(isFetchSafePort(4045)).toBe(false)
    expect(isFetchSafePort(4046)).toBe(true)
    expect(isFetchSafePort(0)).toBe(false)
    expect(isFetchSafePort(70000)).toBe(false)
    expect(isFetchSafePort(1.5)).toBe(false)

    expect(servicePortBand({ first: 32768, last: 60999 })).toEqual({ start: 1024, end: 32767 })
    expect(servicePortBand({ first: 1024, last: 50000 })).toEqual({ start: 50001, end: 65535 })
    expect(() => servicePortBand({ first: 1024, last: 65535 })).toThrow(
      'covers every unprivileged port',
    )

    expect(
      readKernelEphemeralPortRange({ platform: 'linux', readFile: () => '32768\t60999\n' }),
    ).toEqual({ first: 32768, last: 60999 })
    expect(() =>
      readKernelEphemeralPortRange({ platform: 'linux', readFile: () => 'invalid' }),
    ).toThrow('Unreadable kernel ephemeral port range')

    expect(
      readKernelEphemeralPortRange({
        platform: 'darwin',
        execFile: (_cmd, args) => (args[1]?.endsWith('first') ? '49152\n' : '65535\n'),
      }),
    ).toEqual({ first: 49152, last: 65535 })
    expect(() =>
      readKernelEphemeralPortRange({ platform: 'darwin', execFile: () => 'nope' }),
    ).toThrow('Unreadable Darwin port range')
    expect(() => readKernelEphemeralPortRange({ platform: 'win32' })).toThrow(
      'Cannot read the kernel ephemeral port range on win32',
    )
  })

  it('allocates Fetch-safe ports, releases forbidden candidates, and rolls back on failure', async () => {
    let disallowedReleased = false
    const candidates = [
      { port: 4045, release: async () => void (disallowedReleased = true) },
      { port: 4046, release: async () => undefined },
    ]
    const reservations = await allocateReservedPorts(1, async () => [candidates.shift()!])
    expect(disallowedReleased).toBe(true)
    expect(reservations.map((r) => r.port)).toEqual([4046])

    const releasedOnError: number[] = []
    let attempt = 0
    await expect(
      allocateReservedPorts(3, async () => {
        attempt += 1
        if (attempt === 1) {
          return [4046, 4047].map((port) => ({
            port,
            release: async () => void releasedOnError.push(port),
          }))
        }
        throw new Error('replacement failed')
      }),
    ).rejects.toThrow('replacement failed')
    expect(releasedOnError).toEqual([4046, 4047])

    const releasedOnForbiddenFail: number[] = []
    await expect(
      allocateReservedPorts(2, async () => [
        { port: 4046, release: async () => void releasedOnForbiddenFail.push(4046) },
        {
          port: 4045,
          release: async () => {
            throw new Error('forbidden release failed')
          },
        },
      ]),
    ).rejects.toThrow('forbidden release failed')
    expect(releasedOnForbiddenFail).toEqual([4046])

    // Real loopback reservation outside ephemeral range.
    const range = readKernelEphemeralPortRange()
    const real = await allocateReservedPorts(1)
    cleanups.push(...real.map((r) => r.release))
    expect(real[0]!.port < range.first || real[0]!.port > range.last).toBe(true)
  })

  it('retries Fetch-forbidden ephemeral ports and formats loopback origin', async () => {
    const boundPorts = [4045, 4046]
    const fakeServer = {
      address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 4045 }),
      close: (cb: (err?: Error) => void) => cb(),
    }
    const listen = async () => {
      const next = boundPorts.shift()!
      fakeServer.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: next })
    }
    await expect(
      listenOnFetchSafeEphemeralPort(fakeServer as unknown as Server, listen),
    ).resolves.toBe(4046)

    const realServer = http.createServer((_req, res) => res.end('ok'))
    cleanups.push(() => closeServer(realServer))
    const origin = await listenOnFetchSafeLoopback(realServer)
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)

    // reserveLoopbackPorts skips Fetch-forbidden & EADDRINUSE ports, handles exhaustion, non-EADDRINUSE errors, missing address, and close errors.
    const makeFakeNetServer = (
      behavior: (port: number) => 'ok' | 'inuse' | 'fatal' | 'no-addr' | 'close-err',
    ) => {
      let boundPort = 0
      let mode: ReturnType<typeof behavior> = 'ok'
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
      return {
        once(event: string, fn: (...args: unknown[]) => void) {
          const arr = listeners.get(event) ?? []
          arr.push(fn)
          listeners.set(event, arr)
        },
        off(event: string, fn: (...args: unknown[]) => void) {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((f) => f !== fn),
          )
        },
        listen(port: number, _host: string, cb: () => void) {
          boundPort = port
          mode = behavior(port)
          if (mode === 'inuse') {
            for (const fn of listeners.get('error') ?? [])
              fn(Object.assign(new Error('in use'), { code: 'EADDRINUSE' }))
            return
          }
          if (mode === 'fatal') {
            for (const fn of listeners.get('error') ?? []) fn(new Error('EACCES'))
            return
          }
          cb()
        },
        address() {
          return mode === 'no-addr' ? null : { port: boundPort }
        },
        close(cb: (err?: Error) => void) {
          cb(mode === 'close-err' ? new Error('close boom') : undefined)
        },
      } as unknown as Server
    }

    // Band 1024..1720 includes Fetch-forbidden ports 1719 & 1720, plus in-use ports -> skips forbidden & exhausts.
    await expect(
      reserveLoopbackPorts(2, {
        readRange: () => ({ first: 1721, last: 65535 }),
        createServer: () => makeFakeNetServer((p) => (p === 1024 ? 'ok' : 'inuse')),
      }),
    ).rejects.toThrow('Failed to reserve 2 service ports')

    // Fatal bind error aborts and cleans up already-bound servers.
    let fatalStep = 0
    await expect(
      reserveLoopbackPorts(2, {
        readRange: () => ({ first: 1030, last: 65535 }),
        createServer: () => makeFakeNetServer(() => (fatalStep++ === 0 ? 'ok' : 'fatal')),
      }),
    ).rejects.toThrow('EACCES')

    // Missing address after bind throws.
    await expect(
      reserveLoopbackPorts(1, {
        readRange: () => ({ first: 1030, last: 65535 }),
        createServer: () => makeFakeNetServer(() => 'no-addr'),
      }),
    ).rejects.toThrow('Failed to allocate port')

    // Close error rejects release().
    const [closable] = await reserveLoopbackPorts(1, {
      readRange: () => ({ first: 1030, last: 65535 }),
      createServer: () => makeFakeNetServer(() => 'close-err'),
    })
    await expect(closable!.release()).rejects.toThrow('close boom')
  })
})

describe('concurrency broker and trace proxy', () => {
  it('enforces broker limit, skips destroyed waiters, and reports non-200 broker responses', async () => {
    const broker = createAssetConcurrencyBroker(1, '/slot')
    expect(broker.handle('/other', {} as http.ServerResponse)).toBe(false)

    const makeFakeResponse = () => {
      let closeCb: (() => void) | undefined
      return {
        destroyed: false,
        granted: false,
        writeHead: vi.fn(),
        write: vi.fn(() => true),
        once: vi.fn((_event: string, cb: () => void) => {
          closeCb = cb
        }),
        close() {
          closeCb?.()
        },
      }
    }

    const r1 = makeFakeResponse()
    const r2 = makeFakeResponse()
    const r3 = makeFakeResponse()
    const r4 = makeFakeResponse()
    expect(broker.handle('/slot', r1 as unknown as http.ServerResponse)).toBe(true)
    expect(broker.handle('/slot', r2 as unknown as http.ServerResponse)).toBe(true)
    expect(broker.handle('/slot', r3 as unknown as http.ServerResponse)).toBe(true)
    expect(broker.handle('/slot', r4 as unknown as http.ServerResponse)).toBe(true)
    expect(r1.writeHead).toHaveBeenCalledOnce()
    expect(r2.writeHead).not.toHaveBeenCalled()

    // Queued waiter r2 closes before being granted -> removed from queue.
    r2.close()
    // Queued waiter r3 is marked destroyed before r1 finishes -> skipped when granting next.
    r3.destroyed = true
    r1.close()
    // Late close on already-shifted r3 is a safe no-op.
    r3.close()
    expect(r3.writeHead).not.toHaveBeenCalled()
    expect(r4.writeHead).toHaveBeenCalledOnce()
    r4.close()

    // Non-ok response from limiter cancels body and throws.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('busy', { status: 503 })),
    )
    const limiter = createCrossProcessConcurrencyLimiter('http://127.0.0.1:9', { path: '/slot' })
    await expect(limiter(async () => 'never')).rejects.toThrow(
      'asset concurrency broker returned 503',
    )
    vi.unstubAllGlobals()

    // Acquisition timeout applies only while acquiring the lease, not while fn() runs.
    const liveBroker = createAssetConcurrencyBroker(1, '/slot')
    const brokerServer = http.createServer((req, res) => {
      if (!liveBroker.handle(req.url ?? '/', res)) {
        res.writeHead(404)
        res.end()
      }
    })
    cleanups.push(() => closeServer(brokerServer))
    const brokerOrigin = await listenOnFetchSafeLoopback(brokerServer)
    const strictLimiter = createCrossProcessConcurrencyLimiter(brokerOrigin, {
      path: '/slot',
      timeoutMs: 40,
    })

    let inFlight = 0
    let maxInFlight = 0
    const releaseFirst = Promise.withResolvers<void>()
    const firstEntered = Promise.withResolvers<void>()
    const started: Array<Promise<unknown>> = []
    try {
      const first = strictLimiter(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        firstEntered.resolve()
        await releaseFirst.promise
        inFlight -= 1
        return 'first'
      })
      started.push(first)
      await firstEntered.promise
      // Second caller waiting longer than timeoutMs rejects with TimeoutError while first holds lease.
      await expect(
        strictLimiter(async () => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          return 'second'
        }),
      ).rejects.toMatchObject({ name: 'TimeoutError' })
      // Even after 80ms (> 40ms acquisition timeout), a third caller still waits for first to finish.
      await new Promise<void>((resolve) => setTimeout(resolve, 60))
      const longWaitLimiter = createCrossProcessConcurrencyLimiter(brokerOrigin, {
        path: '/slot',
        timeoutMs: 1_000,
      })
      let thirdEntered = false
      const third = longWaitLimiter(async () => {
        thirdEntered = true
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        inFlight -= 1
        return 'third'
      })
      started.push(third)
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      expect(thirdEntered).toBe(false)
      releaseFirst.resolve()
      await expect(Promise.all([first, third])).resolves.toEqual(['first', 'third'])
      expect(maxInFlight).toBe(1)
    } finally {
      releaseFirst.resolve()
      await Promise.allSettled(started)
    }
  })

  it('forwards headers/cookies/streams, isolates request IDs, handles aborts & 502, and validates ports', async () => {
    await expect(createTraceProxy(4045, 'http://127.0.0.1:4046')).rejects.toThrow(
      'Trace proxy port 4045 is forbidden by Fetch',
    )

    let receivedHeaders: http.IncomingHttpHeaders | undefined
    let doneHits = 0
    const upstream = http.createServer(async (req, res) => {
      receivedHeaders = req.headers
      if (req.url === '/redirect') {
        res.writeHead(302, {
          Location: '/done',
          'Set-Cookie': ['hop=1; Path=/'],
        })
        res.end()
        return
      }
      if (req.url === '/done') {
        doneHits += 1
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('followed')
        return
      }
      if (req.url === '/empty') {
        res.writeHead(204)
        res.end()
        return
      }
      if (req.url === '/stream') {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
        res.writeHead(200, {
          'Content-Type': 'text/plain',
          Connection: 'x-drop-res',
          'X-Drop-Res': 'drop',
          'X-Keep-Res': 'keep',
          'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'],
        })
        res.end(`echo:${Buffer.concat(chunks).toString()}`)
        return
      }
      if (req.url === '/disconnect') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '1000' })
        res.write('partial')
        setTimeout(() => res.socket?.destroy(new Error('upstream drop')), 20)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    })
    cleanups.push(() => closeServer(upstream))
    const upstreamOrigin = await listenOnFetchSafeLoopback(upstream)

    const proxy = await createTraceProxy(0, upstreamOrigin, { assetConcurrencyLimit: 2 })
    cleanups.push(() => proxy.close())

    // Health endpoint
    const health = await fetch(`${proxy.origin}/__trace/health`)
    expect(await health.json()).toEqual({ ok: true })

    // Streaming POST + Set-Cookie + hop-by-hop removal (use http.request so Connection header is sent on the wire)
    const postReq = http.request(`${proxy.origin}/stream`, {
      method: 'POST',
      headers: {
        'x-request-id': 'req-a',
        Connection: 'x-drop-req',
        'X-Drop-Req': 'drop',
        'X-Keep-Req': 'keep',
      },
    })
    postReq.end('payload')
    const [postRes] = (await once(postReq, 'response')) as [http.IncomingMessage]
    const postChunks: Buffer[] = []
    for await (const chunk of postRes) postChunks.push(Buffer.from(chunk as Uint8Array))
    expect(Buffer.concat(postChunks).toString()).toBe('echo:payload')
    expect(postRes.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(postRes.headers['x-drop-res']).toBeUndefined()
    expect(postRes.headers['x-keep-res']).toBe('keep')
    expect(receivedHeaders?.['x-drop-req']).toBeUndefined()
    expect(receivedHeaders?.['x-keep-req']).toBe('keep')

    // Redirect responses are forwarded verbatim without following upstream.
    const redirectRes = await fetch(`${proxy.origin}/redirect`, { redirect: 'manual' })
    expect(redirectRes.status).toBe(302)
    expect(redirectRes.headers.get('location')).toBe('/done')
    expect(redirectRes.headers.getSetCookie()).toEqual(['hop=1; Path=/'])
    expect(doneHits).toBe(0)

    // 204 empty response + concurrency limiter over live proxy
    const limiter = createCrossProcessConcurrencyLimiter(proxy.origin)
    const status204 = await limiter(async () => {
      const res = await fetch(`${proxy.origin}/empty`, { headers: { 'x-request-id': 'req-b' } })
      return res.status
    })
    expect(status204).toBe(204)

    // Trace requests bucketed by x-request-id
    const traceRes = await fetch(`${proxy.origin}/__trace/requests`)
    const { requests } = (await traceRes.json()) as {
      requests: Array<{ requestId: string; path: string }>
    }
    expect(requests.filter((r) => r.requestId === 'req-a').map((r) => r.path)).toEqual(['/stream'])
    expect(requests.filter((r) => r.requestId === 'req-b').map((r) => r.path)).toEqual(['/empty'])

    // Upstream disconnect terminates client stream cleanly.
    const outcome = await new Promise<'aborted' | 'end' | 'error'>((resolve) => {
      const req = http.get(`${proxy.origin}/disconnect`)
      req.once('error', () => resolve('error'))
      req.once('response', (res) => {
        res.resume()
        res.once('aborted', () => resolve('aborted'))
        res.once('error', () => resolve('error'))
        res.once('end', () => resolve('end'))
      })
    })
    expect(outcome).not.toBe('end')

    // Upstream unreachable -> 502 error response + explicit port bind.
    const [reserved] = await allocateReservedPorts(1)
    const exactPort = reserved!.port
    await reserved!.release()
    const badProxy = await createTraceProxy(exactPort, 'http://127.0.0.1:1')
    cleanups.push(() => badProxy.close())
    const failRes = await fetch(`${badProxy.origin}/boom`)
    expect(failRes.status).toBe(502)
    expect(await failRes.text()).toContain('Trace proxy failed:')

    // Client disconnect aborts in-flight upstream fetch without writing 502.
    const stallServer = http.createServer(() => {})
    cleanups.push(() => closeServer(stallServer))
    const stallOrigin = await listenOnFetchSafeLoopback(stallServer)
    const abortProxy = await createTraceProxy(0, stallOrigin)
    cleanups.push(() => abortProxy.close())
    const req = http.request(`${abortProxy.origin}/stall`, { method: 'POST' })
    req.on('error', () => undefined)
    const closed = new Promise<void>((resolve) => req.once('close', resolve))
    req.write('chunk')
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    req.destroy()
    await closed
    // buildUpstreamHeaders joins arrays, ignores undefined, and injects fallback host.
    const built = buildUpstreamHeaders(
      { 'x-multi': ['a', 'b'], 'x-undef': undefined, 'content-length': '99' },
      '127.0.0.1:8080',
    )
    expect(built.get('x-multi')).toBe('a, b')
    expect(built.get('host')).toBe('127.0.0.1:8080')
    expect(built.get('content-length')).toBeNull()

    // Double-closing a proxy rejects with server close error.
    await abortProxy.close()
    await expect(abortProxy.close()).rejects.toThrow()
  })
})
