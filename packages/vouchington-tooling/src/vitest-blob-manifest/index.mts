import { createHash, randomUUID } from 'node:crypto'
import {
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import { VITEST_SUITE_PATTERN } from './constants.mts'
import { VitestBlobBundleError } from './bundle-error.mts'

export * from './report-attempt.mts'
export { VITEST_SUITE_PATTERN } from './constants.mts'

export const VITEST_BLOB_MANIFEST_FILENAME = 'vitest-blob-manifest.json'
export const VITEST_BLOB_MANIFEST_VERSION = 'vitest-blob-manifest:v1'

export interface VitestBlobManifest {
  readonly version: typeof VITEST_BLOB_MANIFEST_VERSION
  readonly suite: string
  readonly repository: string
  readonly revision: string
  readonly run: { readonly id: string; readonly attempt: number }
  readonly report: {
    readonly filename: string
    readonly byteLength: number
    readonly sha256: string
  }
}

export interface VitestBlobIdentity {
  readonly suite: string
  readonly repository: string
  readonly revision: string
  readonly runId: string
  readonly runAttempt: number
}

export interface InspectedVitestBlobBundle {
  readonly directory: string
  readonly manifest: VitestBlobManifest
  readonly manifestBytes: Buffer
  readonly reportBytes: Buffer
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).toSorted().join('\0') === keys.toSorted().join('\0')
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function assertRegularFile(path: string, label: string): void {
  if (!lstatSync(path).isFile()) throw new Error(`${label} must be a regular file`)
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function parseVitestBlobManifest(raw: unknown): VitestBlobManifest {
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, ['version', 'suite', 'repository', 'revision', 'run', 'report']) ||
    raw.version !== VITEST_BLOB_MANIFEST_VERSION ||
    typeof raw.suite !== 'string' ||
    !VITEST_SUITE_PATTERN.test(raw.suite) ||
    typeof raw.repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.repository) ||
    typeof raw.revision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(raw.revision) ||
    !isRecord(raw.run) ||
    !hasExactKeys(raw.run, ['id', 'attempt']) ||
    typeof raw.run.id !== 'string' ||
    !/^[1-9][0-9]*$/.test(raw.run.id) ||
    !isPositiveInteger(raw.run.attempt) ||
    !isRecord(raw.report) ||
    !hasExactKeys(raw.report, ['filename', 'byteLength', 'sha256']) ||
    raw.report.filename !== `${raw.suite}.json` ||
    !Number.isSafeInteger(raw.report.byteLength) ||
    Number(raw.report.byteLength) < 0 ||
    typeof raw.report.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(raw.report.sha256)
  ) {
    throw new Error('Vitest blob manifest has an invalid schema')
  }
  return raw as unknown as VitestBlobManifest
}

export function createVitestBlobManifest(
  identity: VitestBlobIdentity,
  reportBytes: Buffer,
): VitestBlobManifest {
  return parseVitestBlobManifest({
    version: VITEST_BLOB_MANIFEST_VERSION,
    suite: identity.suite,
    repository: identity.repository,
    revision: identity.revision,
    run: { id: identity.runId, attempt: identity.runAttempt },
    report: {
      filename: `${identity.suite}.json`,
      byteLength: reportBytes.byteLength,
      sha256: sha256(reportBytes),
    },
  })
}

export function serializeVitestBlobManifest(manifest: VitestBlobManifest): Buffer {
  return Buffer.from(`${JSON.stringify(parseVitestBlobManifest(manifest), null, 2)}\n`)
}

export function writeVitestBlobManifest(directory: string, identity: VitestBlobIdentity): string {
  if (!VITEST_SUITE_PATTERN.test(identity.suite)) throw new Error('Invalid Vitest suite')
  const reportEntries = readdirSync(directory, { withFileTypes: true }).filter(
    (entry) => entry.name.endsWith('.json') && entry.name !== VITEST_BLOB_MANIFEST_FILENAME,
  )
  const reportEntry = reportEntries[0]
  if (
    reportEntries.length !== 1 ||
    reportEntry === undefined ||
    reportEntry.name !== `${identity.suite}.json` ||
    !reportEntry.isFile()
  ) {
    throw new Error(`Expected exactly one ${identity.suite}.json Vitest blob report`)
  }
  const reportPath = join(directory, `${identity.suite}.json`)
  assertRegularFile(reportPath, 'Vitest blob report')
  const bytes = serializeVitestBlobManifest(
    createVitestBlobManifest(identity, readFileSync(reportPath)),
  )
  const manifestPath = join(directory, VITEST_BLOB_MANIFEST_FILENAME)
  const temporaryPath = join(directory, `.${VITEST_BLOB_MANIFEST_FILENAME}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporaryPath, bytes, { flag: 'wx', mode: 0o600 })
    renameSync(temporaryPath, manifestPath)
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch {}
  }
  return manifestPath
}

export function vitestBlobBundlePaths(directory: string, suite: string): readonly [string, string] {
  if (!VITEST_SUITE_PATTERN.test(suite)) throw new Error('Invalid Vitest suite')
  const manifestPath = join(directory, VITEST_BLOB_MANIFEST_FILENAME)
  const reportPath = join(directory, `${suite}.json`)
  assertRegularFile(manifestPath, 'Vitest blob manifest')
  assertRegularFile(reportPath, 'Vitest blob report')
  return [manifestPath, reportPath]
}

export function inspectVitestBlobBundle(directory: string): InspectedVitestBlobBundle {
  const entries = readdirSync(directory, { withFileTypes: true }),
    name = basename(directory)
  if (entries.length !== 2 || entries.some((entry) => !entry.isFile())) {
    throw new VitestBlobBundleError(`Vitest blob bundle ${name} must contain exactly two files`)
  }
  const manifestPath = join(directory, VITEST_BLOB_MANIFEST_FILENAME)
  if (!entries.some((entry) => entry.name === VITEST_BLOB_MANIFEST_FILENAME))
    throw new VitestBlobBundleError(`Invalid Vitest blob bundle ${name}`)
  assertRegularFile(manifestPath, 'Vitest blob manifest')
  const manifestBytes = readFileSync(manifestPath)
  let manifest: VitestBlobManifest
  try {
    manifest = parseVitestBlobManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown)
  } catch (error) {
    throw new VitestBlobBundleError(`Invalid Vitest blob bundle ${name}`, { cause: error })
  }
  const reportPath = join(directory, manifest.report.filename)
  if (!entries.some((entry) => entry.name === manifest.report.filename))
    throw new VitestBlobBundleError(`Invalid Vitest blob bundle ${name}`)
  assertRegularFile(reportPath, 'Vitest blob report')
  const reportBytes = readFileSync(reportPath)
  if (
    reportBytes.byteLength !== manifest.report.byteLength ||
    sha256(reportBytes) !== manifest.report.sha256
  ) {
    throw new VitestBlobBundleError(
      `Vitest blob report integrity check failed for ${manifest.suite}`,
    )
  }
  try {
    JSON.parse(reportBytes.toString('utf8'))
  } catch (error) {
    throw new VitestBlobBundleError(`Vitest blob report is not valid JSON for ${manifest.suite}`, {
      cause: error,
    })
  }
  return { directory, manifest, manifestBytes, reportBytes }
}
