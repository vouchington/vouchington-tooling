import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inspectVitestBlobBundle, writeVitestBlobManifest } from './index.mts'
import { VitestBlobBundleError } from './bundle-error.mts'
import { inspectVitestReportSource } from './reports-source.mts'
import { prepareVitestReports } from './reports.mts'

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  lstat: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, lstatSync: mocks.lstat, renameSync: mocks.rename, rmSync: mocks.rm }
})
vi.mock('./index.mts', async () => {
  const actual = await vi.importActual<typeof import('./index.mts')>('./index.mts')
  return { ...actual, inspectVitestBlobBundle: mocks.inspect }
})

const revision = 'a'.repeat(40)
const identity = {
  suite: 'tooling',
  repository: 'owner/repo',
  revision,
  runId: '42',
  runAttempt: 2,
} as const
const sourceOptions = {
  repository: identity.repository,
  revision,
  run: { id: identity.runId, currentAttempt: 2 },
  expectedSuites: [{ suite: identity.suite }],
}

describe('prepare Vitest report runtime failures', () => {
  let root: string
  let actualRename: typeof renameSync, actualRm: typeof rmSync

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'vitest-report-errors-'))
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const actualManifest = await vi.importActual<typeof import('./index.mts')>('./index.mts')
    actualRename = actualFs.renameSync
    actualRm = actualFs.rmSync
    vi.mocked(lstatSync).mockImplementation(actualFs.lstatSync)
    vi.mocked(renameSync).mockImplementation(actualRename)
    vi.mocked(rmSync).mockImplementation(actualRm)
    vi.mocked(inspectVitestBlobBundle).mockImplementation(actualManifest.inspectVitestBlobBundle)
  })

  afterEach(() => {
    vi.mocked(inspectVitestBlobBundle).mockReset()
    vi.mocked(lstatSync).mockReset()
    vi.mocked(renameSync).mockReset()
    vi.mocked(rmSync).mockReset()
    actualRm(root, { recursive: true, force: true })
  })

  function bundle(source: string): void {
    mkdirSync(join(source, 'bundle'), { recursive: true })
    writeFileSync(join(source, 'bundle', 'tooling.json'), '{}')
    writeVitestBlobManifest(join(source, 'bundle'), identity)
  }

  it.each([
    { controlled: true, flattened: true, message: 'Invalid Vitest blob bundle fixture' },
    { controlled: false, flattened: true, message: 'unclassified failure' },
    { controlled: false, flattened: false, message: 'unclassified failure' },
  ])(
    'classifies only controlled bundle errors ($flattened, $message)',
    ({ flattened, message }) => {
      const source = join(root, 'source')
      mkdirSync(flattened ? source : join(source, 'bundle'), { recursive: true })
      if (flattened) writeFileSync(join(source, 'vitest-blob-manifest.json'), '{}')
      vi.mocked(inspectVitestBlobBundle).mockImplementation(() => {
        throw message.startsWith('Invalid')
          ? new VitestBlobBundleError(message)
          : new Error(message)
      })

      const inspect = () => inspectVitestReportSource(source, 'primary', sourceOptions)
      if (message.startsWith('Invalid Vitest blob bundle'))
        expect(inspect()).toEqual({
          candidates: [],
          rejected: { source: 'primary', reason: 'invalid-bundle' },
        })
      else expect(inspect).toThrow(message)
    },
  )

  it('propagates unclassified source-root I/O failures', () => {
    vi.mocked(lstatSync).mockImplementation(() => {
      throw new Error('unclassified lstat failure')
    })
    expect(() => inspectVitestReportSource(join(root, 'source'), 'primary', sourceOptions)).toThrow(
      'unclassified lstat failure',
    )
  })

  it.each([true, false])('compares report bytes after identical manifests (%s)', (sameReport) => {
    const source = join(root, 'source')
    mkdirSync(join(source, 'one'), { recursive: true })
    mkdirSync(join(source, 'two'))
    let call = 0
    vi.mocked(inspectVitestBlobBundle).mockImplementation((directory) => ({
      directory,
      manifest: {
        version: 'vitest-blob-manifest:v1',
        suite: identity.suite,
        repository: identity.repository,
        revision,
        run: { id: identity.runId, attempt: 2 },
        report: { filename: 'tooling.json', byteLength: 2, sha256: 'a'.repeat(64) },
      },
      manifestBytes: Buffer.from('same'),
      reportBytes: Buffer.from(sameReport || call++ === 0 ? 'one' : 'two'),
    }))

    const inspected = inspectVitestReportSource(source, 'primary', sourceOptions)
    if (sameReport) expect(inspected.candidates).toHaveLength(2)
    else expect(inspected.rejected).toEqual({ source: 'primary', reason: 'intra-source-conflict' })
  })

  it.each([false, true])(
    'preserves the prior output backup when publishing fails (restore fails: %s)',
    (restoreFails) => {
      const primaryDir = join(root, 'primary')
      bundle(primaryDir)
      const outputDir = join(root, 'output')
      mkdirSync(outputDir)
      writeFileSync(join(outputDir, 'existing.json'), 'preserved')

      vi.mocked(renameSync).mockImplementation((source, destination) => {
        const sourceName = basename(String(source))
        if (
          sourceName.startsWith('.output-') &&
          destination === outputDir &&
          (restoreFails || !sourceName.includes('-backup-'))
        )
          throw new Error('publish failed')
        return actualRename(source, destination)
      })

      expect(() =>
        prepareVitestReports({
          primaryDir,
          fallbackDir: join(root, 'fallback'),
          outputDir,
          expectedSuites: [{ suite: identity.suite, minimumAttempt: 1 }],
          repository: identity.repository,
          revision,
          run: { id: identity.runId, currentAttempt: 2 },
        }),
      ).toThrow(restoreFails ? 'Vitest report output rollback failed' : 'publish failed')
      const preserved = restoreFails
        ? join(
            root,
            readdirSync(root).find((entry) => entry.startsWith('.output-backup-'))!,
          )
        : outputDir
      expect(readFileSync(join(preserved, 'existing.json'), 'utf8')).toBe('preserved')
    },
  )

  it('keeps publication failure terminal when no prior output exists', () => {
    const primaryDir = join(root, 'primary'),
      outputDir = join(root, 'output')
    bundle(primaryDir)
    vi.mocked(renameSync).mockImplementation((source, destination) => {
      if (destination === outputDir) throw new Error('publish failed without backup')
      return actualRename(source, destination)
    })

    expect(() =>
      prepareVitestReports({
        primaryDir,
        fallbackDir: join(root, 'fallback'),
        outputDir,
        expectedSuites: [{ suite: identity.suite, minimumAttempt: 1 }],
        repository: identity.repository,
        revision,
        run: { id: identity.runId, currentAttempt: 2 },
      }),
    ).toThrow('publish failed without backup')
    expect(readdirSync(root).some((entry) => entry.startsWith('.output-backup-'))).toBe(false)
  })

  it('removes a superseded backup even when temporary cleanup fails', () => {
    const primaryDir = join(root, 'primary'),
      outputDir = join(root, 'output')
    bundle(primaryDir)
    mkdirSync(outputDir)
    writeFileSync(join(outputDir, 'existing.json'), 'old')
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (basename(String(path)).startsWith('.output-') && !String(path).includes('-backup-'))
        throw new Error('temporary cleanup failed')
      return actualRm(path, options)
    })

    expect(() =>
      prepareVitestReports({
        primaryDir,
        fallbackDir: join(root, 'fallback'),
        outputDir,
        expectedSuites: [{ suite: identity.suite, minimumAttempt: 1 }],
        repository: identity.repository,
        revision,
        run: { id: identity.runId, currentAttempt: 2 },
      }),
    ).toThrow('temporary cleanup failed')
    expect(readdirSync(root).some((entry) => entry.startsWith('.output-backup-'))).toBe(false)
    expect(readFileSync(join(outputDir, 'tooling.json'), 'utf8')).toBe('{}')
  })

  it.each(['manifest', 'report'] as const)(
    'rejects a bundle missing its declared %s and selects the fallback',
    (missing) => {
      const primaryDir = join(root, 'primary'),
        malformed = join(primaryDir, 'bundle'),
        fallbackDir = join(root, 'fallback')
      bundle(primaryDir)
      if (missing === 'manifest') {
        rmSync(join(malformed, 'vitest-blob-manifest.json'))
        writeFileSync(join(malformed, 'other.json'), '{}')
      } else renameSync(join(malformed, 'tooling.json'), join(malformed, 'other.json'))
      bundle(fallbackDir)

      expect(
        prepareVitestReports({
          primaryDir,
          fallbackDir,
          outputDir: join(root, 'output'),
          expectedSuites: [{ suite: identity.suite, minimumAttempt: 1 }],
          repository: identity.repository,
          revision,
          run: { id: identity.runId, currentAttempt: 2 },
        }),
      ).toEqual({
        selected: [{ suite: 'tooling', attempt: 2, sources: ['fallback'] }],
        rejectedSources: [{ source: 'primary', reason: 'invalid-bundle' }],
      })
    },
  )

  it('rejects a dangling source-root symlink and selects the fallback', () => {
    const primaryDir = join(root, 'primary'),
      fallbackDir = join(root, 'fallback')
    symlinkSync(join(root, 'missing'), primaryDir)
    bundle(fallbackDir)
    expect(
      prepareVitestReports({
        primaryDir,
        fallbackDir,
        outputDir: join(root, 'output'),
        expectedSuites: [{ suite: identity.suite, minimumAttempt: 1 }],
        repository: identity.repository,
        revision,
        run: { id: identity.runId, currentAttempt: 2 },
      }),
    ).toMatchObject({
      selected: [{ sources: ['fallback'] }],
      rejectedSources: [{ source: 'primary', reason: 'root-not-directory' }],
    })
  })
})
