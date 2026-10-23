import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadRecordedResponse, parseRecordedResponse } from './recorded-response.mts'
import { toReplayResponse } from './replay-response.mts'

const wire = (text: string) => parseRecordedResponse(Buffer.from(text, 'utf8'))

async function readChunks(response: Response): Promise<Buffer[]> {
  const chunks: Buffer[] = []
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return chunks
}

let fixtureRoot = ''
beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'provider-replay-'))
  writeFileSync(
    join(fixtureRoot, 'cancelled.http'),
    'HTTP/1.1 200 OK\ncontent-type: application/json\n\n{"id":"resp_fixture"}',
  )
})
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

describe('recorded provider responses', () => {
  it('parses the status line and headers and keeps the body bytes untouched', () => {
    const body = 'data: {"text":"café"}\r\n\r\n'
    const recorded = wire(
      `HTTP/2 429 Too Many Requests\r\nContent-Type: text/event-stream\r\ncontent-length: 5\r\nTransfer-Encoding: chunked\r\nretry-after: 2\r\n\r\n${body}`,
    )

    expect(recorded.status).toBe(429)
    expect(recorded.statusText).toBe('Too Many Requests')
    expect(recorded.headers).toEqual([
      ['content-type', 'text/event-stream'],
      ['retry-after', '2'],
    ])
    expect(recorded.body.toString('utf8')).toBe(body)
  })

  it('parses a response with LF line endings and no body', () => {
    const recorded = wire('HTTP/1.1 204\nx-request-id: req_1')

    expect(recorded).toMatchObject({ status: 204, statusText: '', body: Buffer.alloc(0) })
    expect(recorded.headers).toEqual([['x-request-id', 'req_1']])
  })

  it('ends the head at the first blank line even when the body contains a CRLF pair', () => {
    const recorded = wire('HTTP/1.1 200 OK\n\nline\r\n\r\nmore')

    expect(recorded.body.toString('utf8')).toBe('line\r\n\r\nmore')
  })

  it('errors the body stream when the signal was already aborted', async () => {
    const recorded = wire('HTTP/1.1 200 OK\n\nbody')
    const reason = new Error('already aborted')

    const response = toReplayResponse(recorded, undefined, AbortSignal.abort(reason))

    await expect(readChunks(response)).rejects.toBe(reason)
  })

  it('rejects a file that does not start with a status line', () => {
    expect(() => wire('content-type: text/plain\n\nbody')).toThrow(/no HTTP status line/)
    expect(() => parseRecordedResponse(Buffer.alloc(0))).toThrow(/no HTTP status line/)
  })

  it('loads a fixture from a directory path', () => {
    const recorded = loadRecordedResponse('cancelled.http', { fixtureRoot })

    expect(recorded.status).toBe(200)
    expect(recorded.body.toString('utf8')).toBe('{"id":"resp_fixture"}')
  })

  it('replaces literal tokens from a directory URL so a test can keep ids unique', () => {
    const recorded = loadRecordedResponse('cancelled.http', {
      fixtureRoot: pathToFileURL(`${fixtureRoot}/`),
      replace: { resp_fixture: 'resp_owned_by_this_test' },
    })

    expect(recorded.body.toString('utf8')).toContain('"id":"resp_owned_by_this_test"')
    expect(recorded.body.toString('utf8')).not.toContain('resp_fixture')
  })

  it('streams the body in chunks that can split a multi-byte character', async () => {
    const recorded = wire('HTTP/1.1 200 OK\ncontent-type: text/plain\n\nhéllo wörld')

    const chunks = await readChunks(toReplayResponse(recorded, 3))

    expect(chunks.length).toBeGreaterThan(2)
    expect(Buffer.concat(chunks).equals(recorded.body)).toBe(true)
    expect(chunks.some((chunk) => chunk.toString('utf8').includes('�'))).toBe(true)
  })
})
