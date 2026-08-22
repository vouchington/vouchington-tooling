import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { listenOnRunnerUnreservedEphemeralPort } from '../runner-port-policy/index.mts'
import {
  writeTransportControl,
  type PresignedTransportControl,
  readTransportControl,
} from './control.mts'
import { coveragePresignFailureLog, fetchGet } from './http.mts'
import { cmdDownloadCoverage, cmdDownloadVitestBlobs, cmdUpload } from './lib.mts'
import { writeUploadOutcomeOutput } from './outcome.mts'

const openServers: Array<ReturnType<typeof createServer>> = []

async function startStorageServer(failFirstManifestPut = false) {
  const objects = new Map<string, Buffer>()
  let manifestPuts = 0
  let requests = 0
  const server = createServer((request, response) => {
    requests += 1
    const key = new URL(request.url ?? '/', 'http://fixture.invalid').pathname
    if (request.method === 'PUT') {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        if (key === '/always-500') {
          response.statusCode = 500
          response.end()
          return
        }
        if (
          key.endsWith('/coverage-manifest.json') &&
          failFirstManifestPut &&
          manifestPuts++ === 0
        ) {
          response.statusCode = 503
          response.end()
          return
        }
        objects.set(key, Buffer.concat(chunks))
        response.statusCode = 200
        response.end()
      })
      return
    }
    const object = objects.get(key)
    response.statusCode = object ? 200 : 404
    response.end(object)
  })
  openServers.push(server)
  const port = await listenOnRunnerUnreservedEphemeralPort(server, '127.0.0.1')
  return {
    objects,
    origin: `http://127.0.0.1:${port}`,
    requestCount: () => requests,
  }
}

function makeControl(origin: string): PresignedTransportControl {
  return {
    version: 1,
    mode: 'presigned',
    repository: 'owner/repo',
    revision: 'a'.repeat(40),
    run: { id: '123', controlAttempt: 1 },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    coverage: {
      fixture: {
        lcovPut: `${origin}/lcov.info?secret=put`,
        lcovGet: `${origin}/lcov.info?secret=get`,
        manifestPut: `${origin}/coverage-manifest.json?secret=put`,
        manifestGet: `${origin}/coverage-manifest.json?secret=get`,
      },
    },
    blobs: {},
  }
}

const expectedIdentity = {
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  runId: '123',
  currentAttempt: 2,
} as const

describe('coverage transport control and HTTP boundary', () => {
  afterEach(async () => {
    await Promise.all(
      openServers.splice(0).map((server) => new Promise<void>((r) => server.close(() => r()))),
    )
  })

  it('writes and requires a strict mode-0600 control file without exposing URLs', () => {
    const root = mkdtempSync(join(tmpdir(), 'coverage-control-'))
    const path = join(root, 'control.json')
    const control = makeControl('https://storage.invalid')
    writeTransportControl(path, control)

    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(
      readTransportControl(path, {
        repository: control.repository,
        revision: control.revision,
        runId: '123',
        currentAttempt: 2,
      }),
    ).toEqual(control)
    chmodSync(path, 0o644)
    expect(() => readTransportControl(path)).toThrowError(/0600/)
  })

  it('supports an explicit fallback-only control without URL maps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coverage-control-'))
    const path = join(root, 'control.json')
    writeTransportControl(path, {
      version: 1,
      mode: 'fallback-only',
      repository: 'owner/repo',
      revision: 'b'.repeat(40),
      run: { id: '124', controlAttempt: 1 },
      reason: 'presign unavailable',
    })
    expect(readTransportControl(path).mode).toBe('fallback-only')
    const logs: string[] = []
    await expect(
      cmdUpload(path, 'tooling', {
        cwd: root,
        expectedIdentity: {
          repository: 'owner/repo',
          revision: 'b'.repeat(40),
          runId: '124',
          currentAttempt: 2,
        },
      }),
    ).resolves.toEqual({ coverage: false, blob: false })
    await cmdDownloadCoverage(path, join(root, 'download'), {
      expectedIdentity: {
        repository: 'owner/repo',
        revision: 'b'.repeat(40),
        runId: '124',
        currentAttempt: 2,
      },
      log: (line) => logs.push(line),
    })
    await cmdDownloadVitestBlobs(path, join(root, 'blobs'), {
      expectedIdentity: {
        repository: 'owner/repo',
        revision: 'b'.repeat(40),
        runId: '124',
        currentAttempt: 2,
      },
      log: (line) => logs.push(line),
    })
    expect(logs).toEqual([
      '[coverage-transport] S3 unavailable; artifact fallback required',
      '[coverage-transport] S3 unavailable; artifact fallback required',
    ])
  })

  it('rejects expired and malformed control files', () => {
    const root = mkdtempSync(join(tmpdir(), 'coverage-control-'))
    const path = join(root, 'control.json')
    const expired = {
      ...makeControl('https://storage.invalid'),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }
    writeTransportControl(path, expired)
    expect(() => readTransportControl(path)).toThrowError(/expired/)

    writeFileSync(
      path,
      JSON.stringify({
        ...expired,
        run: { id: '123', controlAttempt: 1, unexpected: true },
      }),
      { mode: 0o600 },
    )
    expect(() => readTransportControl(path)).toThrowError(/schema|identity|invalid/)
  })

  it('uploads LCOV before its manifest, retries one transient failure, and downloads both', async () => {
    const server = await startStorageServer(true)
    const root = mkdtempSync(join(tmpdir(), 'coverage-http-'))
    mkdirSync(join(root, 'coverage'))
    writeFileSync(join(root, 'coverage/lcov.info'), 'SF:src/a.ts\nend_of_record\n')
    writeFileSync(join(root, 'coverage/coverage-manifest.json'), '{"version":1}\n')
    const controlPath = join(root, 'control.json')
    writeTransportControl(controlPath, makeControl(server.origin))

    const outcome = await cmdUpload(controlPath, 'fixture', {
      cwd: root,
      retryDelayMs: 1,
      expectedIdentity,
      coverageManifestFilename: 'coverage-manifest.json',
    })
    expect(outcome).toEqual({ coverage: true, blob: false })
    expect([...server.objects.keys()]).toEqual(['/lcov.info', '/coverage-manifest.json'])

    // The exit-code hazard this pins: `{ coverage: true, blob: false }` exits 0 (coverage
    // persisted), which is exactly the case a naive `steps.coverage-primary-N.outcome`-based
    // gate would misread as "blob persisted too." `writeUploadOutcomeOutput` is the actual
    // signal producers must gate the GitHub-fallback blob upload on instead.
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')
    writeUploadOutcomeOutput(outcome, outputPath)
    expect(readFileSync(outputPath, 'utf8')).toBe('blob=false\n')

    const destination = join(root, 'download')
    await cmdDownloadCoverage(controlPath, destination, { retryDelayMs: 1, expectedIdentity })
    expect(readFileSync(join(destination, 'coverage-fixture/lcov.info'), 'utf8')).toContain(
      'SF:src/a.ts',
    )
    expect(readFileSync(join(destination, 'coverage-fixture/coverage-manifest.json'), 'utf8')).toBe(
      '{"version":1}\n',
    )
  })

  it('treats a missing GET object as a quiet terminal miss', async () => {
    const server = await startStorageServer()
    const logs: string[] = []

    expect(
      await fetchGet(`${server.origin}/missing?secret=not-logged`, {
        retryDelayMs: 1,
        log: (line) => logs.push(line),
      }),
    ).toBeNull()
    expect(server.requestCount()).toBe(1)
    expect(logs).toEqual([])
  })

  it('logs and skips an incomplete coverage pair', async () => {
    const server = await startStorageServer()
    server.objects.set('/lcov.info', Buffer.from('SF:src/a.ts\nend_of_record\n'))
    const root = mkdtempSync(join(tmpdir(), 'coverage-incomplete-'))
    const controlPath = join(root, 'control.json')
    writeTransportControl(controlPath, makeControl(server.origin))
    const logs: string[] = []

    await cmdDownloadCoverage(controlPath, join(root, 'download'), {
      expectedIdentity,
      retryDelayMs: 1,
      log: (line) => logs.push(line),
    })
    expect(logs.join('\n')).toContain('Skipped incomplete coverage pair for fixture')
  })

  it('redacts presign URLs while retaining the failure diagnostic', () => {
    const line = coveragePresignFailureLog(
      new Error('request failed for https://bucket.invalid/object?secret=do-not-log'),
    )

    expect(line).toContain('presign failed: Error: request failed for [redacted-url]')
    expect(line).toContain('artifact fallback required')
    expect(line).not.toContain('bucket.invalid')
    expect(line).not.toContain('do-not-log')
  })

  it('fails coverage upload when the manifest never persists and redacts bearer URLs', async () => {
    const server = await startStorageServer()
    const root = mkdtempSync(join(tmpdir(), 'coverage-http-'))
    mkdirSync(join(root, 'coverage'))
    writeFileSync(join(root, 'coverage/lcov.info'), 'SF:src/a.ts\nend_of_record\n')
    writeFileSync(join(root, 'coverage/coverage-manifest.json'), '{"version":1}\n')
    const control = makeControl(server.origin)
    const fixtureUrls = control.coverage.fixture
    if (fixtureUrls === undefined) throw new Error('expected fixture coverage URLs')
    fixtureUrls.manifestPut = `${server.origin}/always-500?bearer=super-secret`
    const controlPath = join(root, 'control.json')
    writeTransportControl(controlPath, control)
    const errors: string[] = []

    const result = await cmdUpload(controlPath, 'fixture', {
      cwd: root,
      retryDelayMs: 1,
      expectedIdentity,
      log: (line) => errors.push(line),
    })
    expect(result.coverage).toBe(false)
    expect(errors.join('\n')).not.toContain('super-secret')
    expect(errors.join('\n')).not.toContain(server.origin)
  })

  it('rejects upload and download through a wrong run, revision, or attempt', async () => {
    const server = await startStorageServer()
    const root = mkdtempSync(join(tmpdir(), 'coverage-http-'))
    const controlPath = join(root, 'control.json')
    writeTransportControl(controlPath, makeControl(server.origin))
    for (const identity of [
      { ...expectedIdentity, runId: '999' },
      { ...expectedIdentity, revision: 'b'.repeat(40) },
      { ...expectedIdentity, currentAttempt: 0 },
    ]) {
      await expect(
        cmdUpload(controlPath, 'fixture', { cwd: root, expectedIdentity: identity }),
      ).rejects.toThrow(/identity/)
      await expect(
        cmdDownloadCoverage(controlPath, join(root, 'download'), { expectedIdentity: identity }),
      ).rejects.toThrow(/identity/)
    }
  })
})
