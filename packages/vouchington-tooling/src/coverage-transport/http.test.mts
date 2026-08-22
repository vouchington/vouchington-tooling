import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { listenOnRunnerUnreservedEphemeralPort } from '../runner-port-policy/index.mts'
import { writeTransportControl } from './control.mts'
import { fetchGet, fetchPut, logTransport, redactTransportLog } from './http.mts'
import { cmdUpload } from './lib.mts'
import { downloadVitestBlobBundles } from './vitest-blob-transport.mts'

const identity = {
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  runId: '9131',
  currentAttempt: 2,
} as const

describe('coverage transport HTTP miss vs exhaustion', () => {
  it('redacts presigned URLs in an Error cause chain', () => {
    const error = new Error('fetch failed')
    error.cause = new Error('connect to https://bucket.invalid/object?secret=do-not-log')
    const line = redactTransportLog(error)
    expect(line).toContain('Error: fetch failed')
    expect(line).toContain('cause:')
    expect(line).toContain('[redacted-url]')
    expect(line).not.toContain('bucket.invalid')
    expect(line).not.toContain('do-not-log')
  })

  it('redacts circular error causes without walking forever', () => {
    const error = new Error('outer')
    error.cause = error
    expect(redactTransportLog(error)).toContain('[circular]')
    expect(redactTransportLog(42)).toBe('42')
  })

  it('writes redacted transport lines to stderr by default', () => {
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      logTransport({}, 'see https://bucket.invalid/object?secret=do-not-log')
    } finally {
      process.stderr.write = original
    }
    expect(writes.join('')).toContain('[redacted-url]')
    expect(writes.join('')).not.toContain('do-not-log')
  })

  it('throws after GET transport exhaustion', async () => {
    const logs: string[] = []
    await expect(
      fetchGet('http://127.0.0.1:1/missing', {
        log: (line) => logs.push(line),
      }),
    ).rejects.toThrow('[coverage-transport] GET exhausted')
    expect(logs.some((line) => line.includes('GET error:'))).toBe(true)
  })

  it('aborts a stalled GET body under the same timeout', async () => {
    const original = globalThis.fetch
    globalThis.fetch = async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            try {
              controller.error(new DOMException('The operation was aborted.', 'AbortError'))
            } catch {
              // The stream may already be errored by a previous abort.
            }
          })
        },
      })
      return new Response(body)
    }
    try {
      await expect(
        fetchGet('http://example.test/stalled', { timeoutMs: 20, retryDelayMs: 0 }),
      ).rejects.toThrow('[coverage-transport] GET exhausted')
    } finally {
      globalThis.fetch = original
    }
  })

  it('skips the retry delay when retryDelayMs is zero', async () => {
    await expect(fetchGet('http://127.0.0.1:1/missing', { retryDelayMs: 0 })).rejects.toThrow(
      '[coverage-transport] GET exhausted',
    )
    await expect(
      fetchPut('http://127.0.0.1:1/object', Buffer.from('x'), { retryDelayMs: 0 }),
    ).resolves.toBe(false)
  })

  it('does not inspect a missing bundle after GET transport exhaustion', async () => {
    const destination = join(mkdtempSync(join(tmpdir(), 'coverage-transport-')), 'download')
    await expect(
      downloadVitestBlobBundles(
        { tooling: { get: 'http://127.0.0.1:1/blob', put: 'unused' } },
        destination,
        { retryDelayMs: 1 },
      ),
    ).rejects.toThrow('[coverage-transport] GET exhausted')
    expect(existsSync(join(destination, 'vitest-blob-tooling'))).toBe(false)
  })

  it('logs blob PUT failure only when pack produced bytes', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 500
      response.end()
    })
    const port = await listenOnRunnerUnreservedEphemeralPort(server, '127.0.0.1')
    try {
      const producer = mkdtempSync(join(tmpdir(), 'coverage-transport-blob-put-'))
      mkdirSync(join(producer, '.vitest-reports'))
      writeFileSync(join(producer, '.vitest-reports/tooling.json'), '{}\n')
      const origin = `http://127.0.0.1:${port}`
      const controlPath = join(producer, 'control.json')
      writeTransportControl(controlPath, {
        version: 1,
        mode: 'presigned',
        repository: identity.repository,
        revision: identity.revision,
        run: { id: identity.runId, controlAttempt: 1 },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        coverage: {},
        blobs: {
          tooling: { put: `${origin}/tooling.tar.gz`, get: `${origin}/tooling.tar.gz` },
        },
      })
      const logs: string[] = []
      const outcome = await cmdUpload(controlPath, 'tooling', {
        cwd: producer,
        retryDelayMs: 1,
        expectedIdentity: identity,
        log: (line) => logs.push(line),
      })
      expect(outcome).toEqual({ coverage: false, blob: false })
      expect(logs.some((line) => line.includes('Vitest blob upload failed for tooling'))).toBe(true)
      expect(logs.some((line) => line.includes('vitest blob pack failed'))).toBe(false)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
