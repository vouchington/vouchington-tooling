import { text } from 'node:stream/consumers'
import { describe, expect, it } from 'vitest'
import { createAwsReplayRequestHandler, replayAwsClient } from './aws-replay-request-handler.mts'
import { createProviderReplay } from './provider-replay.mts'
import { parseRecordedResponse } from './recorded-response.mts'

const wire = (raw: string) => parseRecordedResponse(Buffer.from(raw, 'utf8'))

describe('AWS replay edge cases', () => {
  it('returns an empty body stream for a bodiless response and rethrows request failures', async () => {
    const replay = createProviderReplay()
    replay.respondWith(wire('HTTP/1.1 204 No Content\n\n'))
    const handler = createAwsReplayRequestHandler(replay)
    const request = {
      method: 'GET',
      protocol: 'https:',
      hostname: 'a.example.com',
      path: '/',
      headers: {},
    }

    const { response } = await handler.handle(request)
    await expect(text(response.body)).resolves.toBe('')
    await expect(handler.handle(request)).rejects.toThrow(/no recorded response/)
  })

  it('forces every client instance through the replay handler', () => {
    class Client {
      config: { region: string; requestHandler?: unknown }
      constructor(config: { region: string; requestHandler?: unknown }) {
        this.config = config
      }
    }
    const replay = createProviderReplay()

    const client = new (replayAwsClient(Client, replay))({ region: 'r', requestHandler: 'prod' })

    expect(client.config.region).toBe('r')
    expect(client.config.requestHandler).toHaveProperty('handle')
  })
})
