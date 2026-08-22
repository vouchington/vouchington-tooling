import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import { VITEST_SUITE_PATTERN } from './constants.mts'

export const VITEST_REPORT_ATTEMPT_VERSION = 'vitest-report-attempt:v1'
export const VITEST_REPORT_ATTEMPT_PREFIX = 'vitest-report-attempt-'

export interface VitestReportAttemptIdentity {
  readonly repository: string
  readonly revision: string
  readonly runId: string
  readonly attempt: number
}

export interface VitestReportAttempt {
  readonly version: typeof VITEST_REPORT_ATTEMPT_VERSION
  readonly suite: string
  readonly repository: string
  readonly revision: string
  readonly run: { readonly id: string; readonly attempt: number }
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

function assertIdentity(identity: VitestReportAttemptIdentity): void {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(identity.repository) ||
    !/^[0-9a-f]{40}$/.test(identity.revision) ||
    !/^[1-9][0-9]*$/.test(identity.runId) ||
    !isPositiveInteger(identity.attempt)
  ) {
    throw new Error('Vitest report attempt identity has an invalid schema')
  }
}

export function parseVitestReportAttempt(raw: unknown): VitestReportAttempt {
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, ['version', 'suite', 'repository', 'revision', 'run']) ||
    raw.version !== VITEST_REPORT_ATTEMPT_VERSION ||
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
    !isPositiveInteger(raw.run.attempt)
  ) {
    throw new Error('Vitest report attempt marker has an invalid schema')
  }
  return raw as unknown as VitestReportAttempt
}

export function createVitestReportAttempt(
  suite: string,
  identity: VitestReportAttemptIdentity,
): VitestReportAttempt {
  assertIdentity(identity)
  return parseVitestReportAttempt({
    version: VITEST_REPORT_ATTEMPT_VERSION,
    suite,
    repository: identity.repository,
    revision: identity.revision,
    run: { id: identity.runId, attempt: identity.attempt },
  })
}

export function serializeVitestReportAttempt(marker: VitestReportAttempt): Buffer {
  return Buffer.from(`${JSON.stringify(parseVitestReportAttempt(marker), null, 2)}\n`)
}

function assertDirectory(path: string, label: string): void {
  if (!lstatSync(path).isDirectory()) throw new Error(`${label} must be a directory`)
}

function writeAtomically(path: string, bytes: Buffer): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    try {
      unlinkSync(temporary)
    } catch {
      // A successful rename consumes the temporary name.
    }
  }
}

export function writeVitestReportAttempt(
  directory: string,
  suite: string,
  identity: VitestReportAttemptIdentity,
): string {
  const marker = createVitestReportAttempt(suite, identity)
  mkdirSync(directory, { recursive: true })
  assertDirectory(directory, 'Vitest report attempt directory')
  const path = join(directory, `${suite}.json`)
  writeAtomically(path, serializeVitestReportAttempt(marker))
  return path
}

function readAttempt(path: string, suite: string, identity: VitestReportAttemptIdentity): number {
  const marker = parseVitestReportAttempt(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  if (
    marker.suite !== suite ||
    marker.repository !== identity.repository ||
    marker.revision !== identity.revision ||
    marker.run.id !== identity.runId ||
    marker.run.attempt > identity.attempt
  ) {
    throw new Error(`Vitest report attempt identity does not match this run for ${suite}`)
  }
  return marker.run.attempt
}

/** Reads only exact flattened or per-suite marker artifacts, rejecting all other layouts. */
export function readVitestReportAttempts(
  root: string,
  identity: VitestReportAttemptIdentity,
): Readonly<Record<string, number>> {
  assertIdentity(identity)
  if (!existsSync(root)) return {}
  assertDirectory(root, 'Vitest report attempt root')
  const attempts: Record<string, number> = {}
  const rootEntries = readdirSync(root, { withFileTypes: true })
  const flattened = rootEntries.length === 1 && rootEntries[0]!.isFile()
  for (const artifact of rootEntries) {
    if (flattened) {
      const suite = artifact.name.endsWith('.json') ? artifact.name.slice(0, -'.json'.length) : ''
      if (!VITEST_SUITE_PATTERN.test(suite)) {
        throw new Error('Vitest report attempt root has an unexpected entry')
      }
      attempts[suite] = readAttempt(join(root, artifact.name), suite, identity)
      continue
    }
    if (!artifact.isDirectory() || !artifact.name.startsWith(VITEST_REPORT_ATTEMPT_PREFIX)) {
      throw new Error('Vitest report attempt root has an unexpected entry')
    }
    const suite = artifact.name.slice(VITEST_REPORT_ATTEMPT_PREFIX.length)
    if (!VITEST_SUITE_PATTERN.test(suite)) throw new Error('Invalid Vitest suite attempt artifact')
    const directory = join(root, artifact.name)
    assertDirectory(directory, `Vitest report attempt artifact ${basename(directory)}`)
    const entries = readdirSync(directory, { withFileTypes: true })
    if (entries.length !== 1 || entries[0]!.name !== `${suite}.json` || !entries[0]!.isFile()) {
      throw new Error(`Vitest report attempt artifact ${basename(directory)} is invalid`)
    }
    attempts[suite] = readAttempt(join(directory, entries[0]!.name), suite, identity)
  }
  return Object.fromEntries(
    Object.entries(attempts).toSorted(([left], [right]) => left.localeCompare(right)),
  )
}
