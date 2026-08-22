import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listenOnRunnerUnreservedEphemeralPort } from '../runner-port-policy/index.mts'
import { inspectVitestBlobBundle } from '../vitest-blob-manifest/index.mts'
import { writeTransportControl, type PresignedTransportControl } from './control.mts'
import { cmdDownloadVitestBlobs, cmdUpload } from './lib.mts'
import {
  assertTarMemberSizes,
  downloadVitestBlobBundles,
  packVitestBlobBundle,
  tarVerboseMemberSize,
} from './vitest-blob-transport.mts'

const suite = 'tooling'
const identity = {
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  runId: '9131',
  currentAttempt: 2,
} as const

describe('Vitest blob S3 transport', () => {
  const roots: string[] = []
  const servers: Server[] = []

  afterEach(async () => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    )
  })

  function root(): string {
    const directory = mkdtempSync(join(tmpdir(), 'coverage-transport-'))
    roots.push(directory)
    return directory
  }

  async function serve(bytes: Buffer): Promise<string> {
    const server = createServer((_request, response) => response.end(bytes))
    servers.push(server)
    const port = await listenOnRunnerUnreservedEphemeralPort(server, '127.0.0.1')
    return `http://127.0.0.1:${port}/blob`
  }

  async function storage(): Promise<{ objects: Map<string, Buffer>; origin: string }> {
    const objects = new Map<string, Buffer>()
    const server = createServer((request, response) => {
      const key = new URL(request.url ?? '/', 'http://fixture.invalid').pathname
      if (request.method === 'PUT') {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          objects.set(key, Buffer.concat(chunks))
          response.end()
        })
        return
      }
      const object = objects.get(key)
      response.statusCode = object ? 200 : 404
      response.end(object)
    })
    servers.push(server)
    const port = await listenOnRunnerUnreservedEphemeralPort(server, '127.0.0.1')
    return { objects, origin: `http://127.0.0.1:${port}` }
  }

  function packedFixture(): { archive: Buffer; producer: string } {
    const producer = root()
    const reports = join(producer, '.vitest-reports')
    mkdirSync(join(reports, 'diagnostics'), { recursive: true })
    writeFileSync(join(reports, `${suite}.json`), '{"ok":true}\n')
    writeFileSync(join(reports, 'diagnostics/fork.json'), '{}')
    const archive = packVitestBlobBundle(producer, suite, identity, { retryDelayMs: 1 })
    if (!archive) throw new Error('fixture archive was not packed')
    return { archive, producer }
  }

  it('packs and downloads only the manifest-owned report', async () => {
    const { archive, producer } = packedFixture()
    const archivePath = join(producer, 'bundle.tar.gz')
    writeFileSync(archivePath, archive)
    expect(
      execFileSync('tar', ['tzf', archivePath], { encoding: 'utf8' }).trim().split('\n'),
    ).toEqual(['vitest-blob-manifest.json', 'tooling.json'])

    const destination = join(root(), 'download')
    const logs: string[] = []
    await downloadVitestBlobBundles(
      { tooling: { get: await serve(archive), put: 'unused' } },
      destination,
      { retryDelayMs: 1, log: (line) => logs.push(line) },
    )
    expect(logs).toContain('[coverage-transport] Downloaded vitest blob for tooling')
    expect(existsSync(join(destination, 'vitest-blob-tooling'))).toBe(true)
    const inspected = inspectVitestBlobBundle(join(destination, 'vitest-blob-tooling'))
    expect(inspected.manifest).toMatchObject({ suite, run: { id: '9131', attempt: 2 } })
    expect(inspected.reportBytes.toString()).toBe('{"ok":true}\n')
    expect(existsSync(join(destination, 'vitest-blob-tooling/diagnostics'))).toBe(false)
  })

  it('downloads reports larger than the child-process stdout buffer', async () => {
    const producer = root()
    const reports = join(producer, '.vitest-reports')
    mkdirSync(reports)
    const report = `${JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) })}\n`
    writeFileSync(join(reports, `${suite}.json`), report)
    const archive = packVitestBlobBundle(producer, suite, identity, { retryDelayMs: 1 })
    if (!archive) throw new Error('large fixture archive was not packed')
    const destination = join(root(), 'download')

    await downloadVitestBlobBundles(
      { tooling: { get: await serve(archive), put: 'unused' } },
      destination,
      { retryDelayMs: 1 },
    )

    expect(readFileSync(join(destination, 'vitest-blob-tooling', `${suite}.json`), 'utf8')).toBe(
      report,
    )
  })

  it('removes a stale invalid marker after a successful download', async () => {
    const { archive } = packedFixture()
    const destination = join(root(), 'download')
    mkdirSync(destination)
    writeFileSync(join(destination, '.invalid-tooling'), 'stale marker\n')

    await downloadVitestBlobBundles(
      { tooling: { get: await serve(archive), put: 'unused' } },
      destination,
      { retryDelayMs: 1 },
    )

    expect(existsSync(join(destination, '.invalid-tooling'))).toBe(false)
  })

  it('logs when no remote report is available', async () => {
    const server = await storage()
    const logs: string[] = []

    await downloadVitestBlobBundles(
      { tooling: { get: `${server.origin}/missing`, put: 'unused' } },
      join(root(), 'download'),
      { retryDelayMs: 1, log: (line) => logs.push(line) },
    )

    expect(logs).toContain('[coverage-transport] No vitest blob available for tooling')
  })

  it('rejects archives with extra, duplicate, or non-file entries', async () => {
    const { archive, producer } = packedFixture()
    const validArchive = join(producer, 'valid.tar.gz')
    writeFileSync(validArchive, archive)
    const unpacked = join(producer, 'unpacked')
    mkdirSync(unpacked)
    execFileSync('tar', ['xzf', validArchive, '-C', unpacked])

    const fixtures = new Map<string, Buffer>()
    const makeFixture = (name: string, entries: string[]) => {
      const fixtureArchive = join(producer, `${name}.tar.gz`)
      execFileSync('tar', ['czf', fixtureArchive, '-C', unpacked, ...entries])
      fixtures.set(name, readFileSync(fixtureArchive))
    }
    writeFileSync(join(unpacked, 'extra.txt'), 'extra')
    makeFixture('extra', ['vitest-blob-manifest.json', 'tooling.json', 'extra.txt'])
    makeFixture('duplicate', ['vitest-blob-manifest.json', 'tooling.json', 'tooling.json'])
    mkdirSync(join(unpacked, 'nested'))
    makeFixture('directory', ['vitest-blob-manifest.json', 'tooling.json', 'nested'])
    const traversalArchive = join(producer, 'traversal.tar.gz')
    execFileSync('tar', [
      'czf',
      traversalArchive,
      '-C',
      join(unpacked, 'nested'),
      '../tooling.json',
    ])
    fixtures.set('traversal', readFileSync(traversalArchive))
    const linkTarget = join(unpacked, 'target.json')
    writeFileSync(linkTarget, '{}')
    rmSync(join(unpacked, 'tooling.json'))
    symlinkSync(linkTarget, join(unpacked, 'tooling.json'))
    makeFixture('symlink', ['vitest-blob-manifest.json', 'tooling.json'])

    for (const [name, bytes] of fixtures) {
      const destination = join(root(), name)
      const markerTarget = join(destination, 'marker-target')
      if (name === 'extra') {
        mkdirSync(destination)
        writeFileSync(join(destination, '.invalid-tooling'), 'stale marker\n')
      }
      if (name === 'duplicate') {
        mkdirSync(join(destination, '.invalid-tooling'), { recursive: true })
      }
      if (name === 'symlink') {
        mkdirSync(destination)
        writeFileSync(markerTarget, 'do not overwrite\n')
        symlinkSync(markerTarget, join(destination, '.invalid-tooling'))
      }
      await expect(
        downloadVitestBlobBundles(
          { tooling: { get: await serve(bytes), put: 'unused' } },
          destination,
          { retryDelayMs: 1 },
        ),
      ).rejects.toThrow(/unexpected entries|regular files/)
      const markerPath = join(destination, '.invalid-tooling')
      expect(existsSync(markerPath)).toBe(true)
      const markerContents = name === 'duplicate' ? null : readFileSync(markerPath, 'utf8')
      expect(markerContents).toBe(name === 'duplicate' ? null : 'invalid archive\n')
      const markerTargetContents =
        name === 'symlink' ? readFileSync(markerTarget, 'utf8') : 'do not overwrite\n'
      expect(markerTargetContents).toBe('do not overwrite\n')
      expect(existsSync(join(destination, 'vitest-blob-tooling'))).toBe(false)
    }
  })

  it('falls back cleanly when a producer cannot form one owned report bundle', () => {
    const producer = root()
    const reports = join(producer, '.vitest-reports')
    mkdirSync(reports)
    writeFileSync(join(reports, 'tooling.json'), '{}')
    writeFileSync(join(reports, 'other.json'), '{}')
    const logs: string[] = []

    expect(
      packVitestBlobBundle(producer, suite, identity, { log: (line) => logs.push(line) }),
    ).toBeNull()
    expect(logs.join('\n')).toContain('vitest blob pack failed')
  })

  it('returns null when a packed report exceeds the member ceiling', () => {
    const producer = root()
    const reports = join(producer, '.vitest-reports')
    mkdirSync(reports)
    writeFileSync(join(reports, 'tooling.json'), `${'x'.repeat(32)}\n`)
    const logs: string[] = []
    expect(
      packVitestBlobBundle(producer, suite, identity, {
        maxMemberBytes: 8,
        log: (line) => logs.push(line),
      }),
    ).toBeNull()
    expect(logs.join('\n')).toContain('vitest blob pack failed')
  })

  it('rejects a traversal-shaped control key before constructing archive paths', async () => {
    const { archive } = packedFixture()
    const destination = join(root(), 'download')
    await expect(
      downloadVitestBlobBundles(
        { '../../outside': { get: await serve(archive), put: 'unused' } },
        destination,
        { retryDelayMs: 1 },
      ),
    ).rejects.toThrow('Invalid Vitest suite')
    expect(existsSync(join(destination, '../../outside'))).toBe(false)
  })

  it('parses tar verbose sizes and rejects members over the ceiling', () => {
    expect(tarVerboseMemberSize('-rw-r--r--  0 runner staff  12 Jan  1 00:00 tooling.json')).toBe(
      12,
    )
    expect(tarVerboseMemberSize('-rw-r--r-- 0/0            12 2026-08-22 10:00 tooling.json')).toBe(
      12,
    )
    expect(() => tarVerboseMemberSize('-rw-r--r--  0 x y not-a-size Jan 1 00:00 x')).toThrow(
      /malformed/,
    )
    expect(() => tarVerboseMemberSize('not a tar listing')).toThrow(/malformed/)
    expect(() =>
      assertTarMemberSizes([
        '-rw-r--r-- 0/0 12 2026-08-22 10:00 vitest-blob-manifest.json',
        '-rw-r--r-- 0/0 33554433 2026-08-22 10:00 tooling.json',
      ]),
    ).toThrow(/member size limit/)
    expect(() =>
      assertTarMemberSizes([
        '-rw-r--r--  0 x y 12 Jan  1 00:00 vitest-blob-manifest.json',
        '-rw-r--r--  0 x y 12 Jan  1 00:00 tooling.json',
      ]),
    ).not.toThrow()
  })

  it('uploads and downloads a manifest-bound blob independently of coverage', async () => {
    const server = await storage()
    const producer = root()
    const reports = join(producer, '.vitest-reports')
    mkdirSync(reports)
    writeFileSync(join(reports, 'tooling.json'), '{}')
    const control: PresignedTransportControl = {
      version: 1,
      mode: 'presigned',
      repository: identity.repository,
      revision: identity.revision,
      run: { id: identity.runId, controlAttempt: 1 },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      coverage: {},
      blobs: {
        tooling: {
          put: `${server.origin}/tooling.tar.gz?operation=put`,
          get: `${server.origin}/tooling.tar.gz?operation=get`,
        },
      },
    }
    const controlPath = join(producer, 'control.json')
    writeTransportControl(controlPath, control)

    await expect(
      cmdUpload(controlPath, 'tooling', { cwd: producer, expectedIdentity: identity }),
    ).resolves.toEqual({ coverage: false, blob: true })
    expect(server.objects.has('/tooling.tar.gz')).toBe(true)
    const destination = join(root(), 'download')
    await cmdDownloadVitestBlobs(controlPath, destination, { expectedIdentity: identity })
    expect(readFileSync(join(destination, 'vitest-blob-tooling/tooling.json'), 'utf8')).toBe('{}')
  })
})
