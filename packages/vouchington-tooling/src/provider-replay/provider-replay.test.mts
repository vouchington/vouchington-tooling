import { describe, expect, it } from 'vitest'
import { createProviderReplay, replayClient } from './provider-replay.mts'
import { parseRecordedResponse } from './recorded-response.mts'

const wire = (text: string) => parseRecordedResponse(Buffer.from(text, 'utf8'))

describe('provider replay transport', () => {
  const ok = wire('HTTP/1.1 200 OK\ncontent-type: application/json\n\n{"ok":true}')

  it('answers requests in order and captures what the SDK sent', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok, wire('HTTP/1.1 404 Not Found\n\n{}'))

    const first = await replay.fetch('https://provider.example.com/v1/things', {
      method: 'POST',
      headers: { Authorization: 'Bearer key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'm', stream: true }),
    })
    const second = await replay.fetch(new Request('https://provider.example.com/v1/other'))

    expect(await first.json()).toEqual({ ok: true })
    expect(second.status).toBe(404)
    expect(replay.requests.map((request) => request.method)).toEqual(['POST', 'GET'])
    expect(replay.requests[0]?.headers).toMatchObject({ authorization: 'Bearer key' })
    expect(replay.requests[0]?.json()).toEqual({ model: 'm', stream: true })
    expect(replay.requests[1]?.body).toBeUndefined()
    replay.assertDrained()
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects the chunk size %s', async (chunkBytes) => {
    const replay = createProviderReplay({ chunkBytes })
    replay.respondWith(ok)

    await expect(replay.fetch('https://provider.example.com/a')).rejects.toThrow(RangeError)
  })

  it('forwards extra constructor arguments to the client', () => {
    class Client {
      args: unknown[]
      constructor(...args: unknown[]) {
        this.args = args
      }
    }

    const client = new (replayClient(Client, createProviderReplay()))({ a: 1 }, 'second')

    expect(client.args[1]).toBe('second')
  })

  it('parses an empty body as null JSON', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)

    await replay.fetch('https://provider.example.com/v1/things')

    expect(replay.requests[0]?.json()).toBeNull()
  })

  it('captures form bodies as bytes', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)

    await replay.fetch('https://provider.example.com/v1/charges', {
      method: 'POST',
      body: new URLSearchParams({ amount: '100' }),
    })

    expect(replay.requests[0]?.body?.toString('utf8')).toBe('amount=100')
    // Headers fetch derives from the body are part of what is sent.
    expect(replay.requests[0]?.headers['content-type']).toMatch(
      /^application\/x-www-form-urlencoded/,
    )
  })

  it('keeps responses in call order when an earlier request body arrives later', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok, wire('HTTP/1.1 404 Not Found\n\n{}'))
    let finishUpload!: () => void
    const slowUpload = new ReadableStream<Uint8Array>({
      start(controller) {
        finishUpload = () => {
          controller.enqueue(new TextEncoder().encode('{"slow":true}'))
          controller.close()
        }
      },
    })

    const first = replay.fetch('https://provider.example.com/slow', {
      method: 'POST',
      body: slowUpload,
      duplex: 'half',
    } as RequestInit)
    const second = replay.fetch('https://provider.example.com/fast')
    finishUpload()

    expect((await first).status).toBe(200)
    expect((await second).status).toBe(404)
    expect(replay.requests.map((request) => request.url)).toEqual([
      'https://provider.example.com/slow',
      'https://provider.example.com/fast',
    ])
    expect(replay.requests[0]?.json()).toEqual({ slow: true })
  })

  it('rejects a request aborted while its body is still being read', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)
    const controller = new AbortController()
    // The upload never finishes: the abort alone must end the call.
    const upload = new ReadableStream<Uint8Array>({ start: () => undefined })

    const pending = replay.fetch('https://provider.example.com/a', {
      method: 'POST',
      body: upload,
      duplex: 'half',
      signal: controller.signal,
    } as RequestInit)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('fails loudly when a request has no recorded response', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)
    await replay.fetch('https://provider.example.com/a')

    await expect(replay.fetch('https://provider.example.com/b')).rejects.toThrow(
      /no recorded response for request 2/,
    )
  })

  it('reports a recorded response that was never requested', () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)

    expect(() => replay.assertDrained()).toThrow(/1 recorded response\(s\) unrequested/)
    replay.reset()
    expect(() => replay.assertDrained()).not.toThrow()
    expect(replay.requests).toEqual([])
  })

  it('rejects an aborted request before recording it', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)

    await expect(
      replay.fetch('https://provider.example.com/a', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(replay.requests).toEqual([])
  })

  it('rejects a request whose own signal is already aborted', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)
    const aborted = new Request('https://provider.example.com/a', { signal: AbortSignal.abort() })

    await expect(replay.fetch(aborted)).rejects.toMatchObject({ name: 'AbortError' })
    expect(replay.requests).toEqual([])
    expect(() => replay.assertDrained()).toThrow(/unrequested/)
  })

  it('errors the body stream when the request is aborted while it is being read', async () => {
    const replay = createProviderReplay({ chunkBytes: 4 })
    replay.respondWith(
      wire('HTTP/1.1 200 OK\ncontent-type: text/event-stream\n\ndata: 1\n\ndata: 2\n\n'),
    )
    const controller = new AbortController()

    const response = await replay.fetch('https://provider.example.com/a', {
      signal: controller.signal,
    })
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    controller.abort()

    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('forces every client instance through the replay', async () => {
    const replay = createProviderReplay()
    replay.respondWith(ok)
    class Client {
      options: { apiKey: string; fetch?: typeof replay.fetch }
      constructor(options: { apiKey: string; fetch?: typeof replay.fetch }) {
        this.options = options
      }
    }

    const client = new (replayClient(Client, replay))({ apiKey: 'k', fetch: () => fail() })

    expect(client.options.apiKey).toBe('k')
    expect(client.options.fetch).toBe(replay.fetch)
  })
  it('keeps fetch URL normalization while preserving raw HTTP transport paths', async () => {
    const replay = createProviderReplay()
    replay.respondWith(wire('HTTP/1.1 200 OK\n\nfetch'), wire('HTTP/1.1 200 OK\n\nhttp'))
    const url = 'https://provider.example.com/a/%2e%2e/b'
    await expect((await replay.fetch(url)).text()).resolves.toBe('fetch')
    await expect((await replay.sendHttpRequest(url)).text()).resolves.toBe('http')
    expect(replay.requests.map((request) => request.url)).toEqual([
      'https://provider.example.com/b',
      url,
    ])
    replay.assertDrained()
  })

  it('rejects invalid request construction asynchronously for both transports', async () => {
    const replay = createProviderReplay()
    await expect(replay.fetch('invalid-url')).rejects.toBeInstanceOf(TypeError)
    await expect(replay.sendHttpRequest('invalid-url')).rejects.toBeInstanceOf(TypeError)
    expect(replay.requests).toEqual([])
  })
  it('captures explicit HTTP headers without adding fetch body defaults', async () => {
    const replay = createProviderReplay()
    replay.respondWith(wire('HTTP/1.1 200 OK\n\naccepted'))
    const response = await replay.sendHttpRequest('https://provider.example.com/', {
      method: 'POST',
      body: 'payload',
      headers: { 'x-custom': 'explicit' },
    })
    await expect(response.text()).resolves.toBe('accepted')
    expect(replay.requests[0]).toMatchObject({
      headers: { 'x-custom': 'explicit' },
      body: Buffer.from('payload'),
    })
    expect(replay.requests[0]?.headers).not.toHaveProperty('content-type')
    replay.assertDrained()
  })
})

function fail(): never {
  throw new Error('the production fetch must not be used')
}
