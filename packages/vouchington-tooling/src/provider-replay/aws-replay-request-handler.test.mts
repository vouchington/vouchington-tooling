import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { ReadableStream } from 'node:stream/web'
import { describe, expect, it, vi } from 'vitest'
import { createAwsReplayRequestHandler } from './aws-replay-request-handler.mts'
import { createProviderReplay } from './provider-replay.mts'
import { parseRecordedResponse } from './recorded-response.mts'

const wire = (raw: string) => parseRecordedResponse(Buffer.from(raw, 'utf8'))

describe('AWS replay request handler', () => {
  it('forwards the SDK request to the replay and returns the recorded response in the shape the SDK reads', async () => {
    const replay = createProviderReplay()
    replay.respondWith(wire('HTTP/1.1 200 OK\nx-amzn-requestid: req-1\n\nhello'))

    const { response } = await createAwsReplayRequestHandler(replay).handle({
      method: 'POST',
      protocol: 'https:',
      hostname: 'service.example.com',
      port: 8443,
      path: '/model/a%3A0/invoke',
      query: { z: 'a b', list: ['b', 'a'], one: '1', none: null, "punct!'": '(*)' },
      headers: { 'content-type': 'text/plain' },
      body: 'payload',
    })

    expect(replay.requests).toHaveLength(1)
    expect(replay.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://service.example.com:8443/model/a%3A0/invoke?list=b&list=a&none&one=1&punct%21%27=%28%2A%29&z=a%20b',
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('payload'),
    })
    expect(response).toMatchObject({
      statusCode: 200,
      reason: 'OK',
      headers: { 'x-amzn-requestid': 'req-1' },
    })
    expect(await text(response.body)).toBe('hello')
    replay.assertDrained()
  })

  it('rejects with the abort reason when the SDK request was already aborted', async () => {
    const replay = createProviderReplay()
    const controller = new AbortController()
    controller.abort(new Error('caller aborted'))

    await expect(
      createAwsReplayRequestHandler(replay).handle(
        {
          method: 'GET',
          protocol: 'https:',
          hostname: 'service.example.com',
          path: '/',
          headers: {},
        },
        { abortSignal: controller.signal },
      ),
    ).rejects.toThrow('caller aborted')
  })

  it('has the lifecycle methods the SDK calls on a handler', () => {
    const handler = createAwsReplayRequestHandler(createProviderReplay())

    expect(() => handler.destroy()).not.toThrow()
    expect(() => handler.updateHttpClientConfig()).not.toThrow()
    expect(handler.httpHandlerConfigs()).toEqual({})
  })

  it('preserves recorded fragments across event boundaries', async () => {
    const replay = createProviderReplay({ chunkBytes: 3 })
    replay.respondWith(
      wire('HTTP/1.1 200 OK\ncontent-type: text/event-stream\n\ndata: 1\n\ndata: 2\n\n'),
    )
    const { response } = await createAwsReplayRequestHandler(replay).handle({
      method: 'GET',
      protocol: 'https:',
      hostname: 'service.example.com',
      path: '/',
      headers: {},
    })
    const chunks: string[] = []
    response.body.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))

    await expect(text(response.body)).resolves.toBe('data: 1\n\ndata: 2\n\n')
    // Node may coalesce adjacent queued chunks under load, so assert the split, not exact pieces.
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe('data: 1\n\ndata: 2\n\n')
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true)
    replay.assertDrained()
  })

  it('propagates cancellation while the recorded body is being consumed', async () => {
    const replay = createProviderReplay({ chunkBytes: 3 })
    replay.respondWith(wire('HTTP/1.1 200 OK\n\nfragmented response'))
    const controller = new AbortController()
    const { response } = await createAwsReplayRequestHandler(replay).handle(
      {
        method: 'GET',
        protocol: 'https:',
        hostname: 'service.example.com',
        path: '/',
        headers: {},
      },
      { abortSignal: controller.signal },
    )
    const reason = new Error('caller cancelled the response')
    const reading = text(response.body)
    controller.abort(reason)

    await expect(reading).rejects.toBe(reason)
    replay.assertDrained()
  })

  it.each([
    ['Node', () => Readable.from(['streamed ', 'payload'])],
    [
      'Web',
      () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('streamed '))
            controller.enqueue(Buffer.from('payload'))
            controller.close()
          },
        }),
    ],
  ] as const)('captures a %s streaming request body', async (_kind, createBody) => {
    const replay = createProviderReplay()
    replay.respondWith(wire('HTTP/1.1 200 OK\n\naccepted'))
    const { response } = await createAwsReplayRequestHandler(replay).handle({
      method: 'POST',
      protocol: 'https:',
      hostname: 'service.example.com',
      path: '/',
      headers: {},
      body: createBody(),
    })

    expect(replay.requests[0]?.body).toEqual(Buffer.from('streamed payload'))
    await expect(text(response.body)).resolves.toBe('accepted')
    replay.assertDrained()
  })

  it('does not send a request when a structural signal was already aborted', async () => {
    const replay = createProviderReplay()
    const reason = new Error('structural caller aborted')
    const signal = { aborted: true, reason, onabort: null }

    await expect(
      createAwsReplayRequestHandler(replay).handle(
        {
          method: 'GET',
          protocol: 'https:',
          hostname: 'service.example.com',
          path: '/',
          headers: {},
        },
        { abortSignal: signal },
      ),
    ).rejects.toBe(reason)
    expect(replay.requests).toEqual([])
  })

  it('observes a legacy onabort signal and restores its callback after the body closes', async () => {
    const replay = createProviderReplay({ chunkBytes: 3 })
    replay.respondWith(wire('HTTP/1.1 200 OK\n\nfragmented response'))
    const original = vi.fn<() => void>()
    const signal = { aborted: false, onabort: original }
    const { response } = await createAwsReplayRequestHandler(replay).handle(
      {
        method: 'GET',
        protocol: 'https:',
        hostname: 'service.example.com',
        path: '/',
        headers: {},
      },
      { abortSignal: signal },
    )
    const reading = text(response.body)
    signal.aborted = true
    signal.onabort()

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    expect(original).toHaveBeenCalledOnce()
    expect(signal.onabort).toBe(original)
    replay.assertDrained()
  })

  it('observes and detaches a structural EventTarget signal while consuming the response', async () => {
    const replay = createProviderReplay({ chunkBytes: 3 })
    replay.respondWith(wire('HTTP/1.1 200 OK\n\nfragmented response'))
    const controller = new AbortController()
    const signal = {
      get aborted() {
        return controller.signal.aborted
      },
      get reason(): unknown {
        return controller.signal.reason
      },
      addEventListener: (...args: Parameters<AbortSignal['addEventListener']>) =>
        controller.signal.addEventListener(...args),
      removeEventListener: vi.fn<AbortSignal['removeEventListener']>(
        (...args: Parameters<AbortSignal['removeEventListener']>) =>
          controller.signal.removeEventListener(...args),
      ),
    }
    const { response } = await createAwsReplayRequestHandler(replay).handle(
      {
        method: 'GET',
        protocol: 'https:',
        hostname: 'service.example.com',
        path: '/',
        headers: {},
      },
      { abortSignal: signal },
    )
    const reason = new Error('structural response cancelled')
    const reading = text(response.body)
    controller.abort(reason)

    await expect(reading).rejects.toBe(reason)
    expect(signal.removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    replay.assertDrained()
  })
  it.each(['/a/../b', '/a/%2e%2e/b', '/a/./b', '/%2E/b'])(
    'preserves serialized AWS path bytes for %s',
    async (path) => {
      const replay = createProviderReplay()
      replay.respondWith(wire('HTTP/1.1 200 OK\n\naccepted'))
      const { response } = await createAwsReplayRequestHandler(replay).handle({
        method: 'GET',
        protocol: 'https:',
        hostname: 'service.example.com',
        path,
        headers: {},
        query: { key: 'a b' },
      })
      expect(replay.requests[0]?.url).toBe(`https://service.example.com${path}?key=a%20b`)
      await expect(text(response.body)).resolves.toBe('accepted')
      replay.assertDrained()
    },
  )
})
