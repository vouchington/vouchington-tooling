/* eslint-disable max-lines -- untrusted artifact discovery and publication form one security boundary. */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import {
  inspectVitestBlobBundle,
  VITEST_BLOB_MANIFEST_FILENAME,
  VITEST_SUITE_PATTERN,
  type InspectedVitestBlobBundle,
} from './index.mts'

export interface PrepareVitestReportsOptions {
  readonly primaryDir: string
  readonly fallbackDir: string
  readonly outputDir: string
  readonly expectedSuites: readonly VitestReportExpectation[]
  readonly repository: string
  readonly revision: string
  readonly run: { readonly id: string; readonly currentAttempt: number }
}

export type VitestReportExpectation = { readonly suite: string; readonly minimumAttempt: number }

export interface SelectedVitestReport {
  readonly suite: string
  readonly attempt: number
  readonly sources: readonly ('primary' | 'fallback')[]
}

type Candidate = InspectedVitestBlobBundle & { readonly source: 'primary' | 'fallback' }

function inspectSource(root: string, source: Candidate['source']): Candidate[] {
  if (!existsSync(root)) return []
  if (!lstatSync(root).isDirectory()) throw new Error(`Vitest ${source} root must be a directory`)
  const entries = readdirSync(root, { withFileTypes: true })
  if (entries.length === 0) return []
  const isFlattened = entries.some((entry) => entry.name === VITEST_BLOB_MANIFEST_FILENAME)
  if (isFlattened) return [{ ...inspectVitestBlobBundle(root), source }]
  const invalid = entries.find((entry) => {
    const suite = entry.name.startsWith('.invalid-') ? entry.name.slice('.invalid-'.length) : ''
    return entry.isFile() && VITEST_SUITE_PATTERN.test(suite)
  })
  if (invalid) throw new Error(`Vitest ${source} root contains an invalid archive marker`)
  const unexpected = entries.find((entry) => !entry.isDirectory())
  if (unexpected) throw new Error(`Vitest ${source} root has an unexpected entry`)
  return entries
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({ ...inspectVitestBlobBundle(join(root, entry.name)), source }))
}

function validateOptions(options: PrepareVitestReportsOptions): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
    throw new Error('Invalid Vitest repository')
  }
  if (!/^[0-9a-f]{40}$/.test(options.revision)) throw new Error('Invalid Vitest revision')
  if (!/^[1-9][0-9]*$/.test(options.run.id) || !Number.isSafeInteger(options.run.currentAttempt)) {
    throw new Error('Invalid Vitest run')
  }
  if (options.run.currentAttempt < 1) throw new Error('Invalid Vitest run')
  for (const expectation of options.expectedSuites) {
    if (
      !VITEST_SUITE_PATTERN.test(expectation.suite) ||
      !Number.isSafeInteger(expectation.minimumAttempt)
    ) {
      throw new Error('Invalid expected Vitest suite')
    }
    if (expectation.minimumAttempt < 1 || expectation.minimumAttempt > options.run.currentAttempt) {
      throw new Error('Invalid expected Vitest suite attempt')
    }
  }
}

function validateIdentity(candidate: Candidate, options: PrepareVitestReportsOptions): void {
  const { manifest } = candidate
  if (
    manifest.repository !== options.repository ||
    manifest.revision !== options.revision ||
    manifest.run.id !== options.run.id
  ) {
    throw new Error(`Vitest blob identity does not match this run for ${manifest.suite}`)
  }
  if (manifest.run.attempt > options.run.currentAttempt) {
    throw new Error(`Vitest blob attempt is from the future for ${manifest.suite}`)
  }
}

function identical(left: Candidate, right: Candidate): boolean {
  return (
    left.manifestBytes.equals(right.manifestBytes) && left.reportBytes.equals(right.reportBytes)
  )
}

function rejectConflictingCopies(candidates: readonly Candidate[]): void {
  const firstByIdentity = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const key = `${candidate.manifest.suite}\0${candidate.manifest.run.attempt}`
    const first = firstByIdentity.get(key)
    if (first && !identical(first, candidate)) {
      throw new Error(
        `Conflicting Vitest blobs for ${candidate.manifest.suite} attempt ${candidate.manifest.run.attempt}`,
      )
    }
    firstByIdentity.set(key, first ?? candidate)
  }
}

function selectCandidates(
  candidates: readonly Candidate[],
  options: PrepareVitestReportsOptions,
): { candidate: Candidate; sources: SelectedVitestReport['sources'] }[] {
  const expected = new Map(
    options.expectedSuites.map((expectation) => [expectation.suite, expectation.minimumAttempt]),
  )
  if (expected.size !== options.expectedSuites.length)
    throw new Error('Expected Vitest suites must be unique')
  for (const candidate of candidates) validateIdentity(candidate, options)
  rejectConflictingCopies(candidates)
  for (const candidate of candidates) {
    if (
      !expected.has(candidate.manifest.suite) &&
      candidate.manifest.run.attempt === options.run.currentAttempt
    ) {
      throw new Error(`Unexpected current-attempt Vitest suite: ${candidate.manifest.suite}`)
    }
  }
  return options.expectedSuites
    .toSorted((left, right) => left.suite.localeCompare(right.suite))
    .map((expectation) => {
      const matches = candidates.filter(
        (candidate) =>
          candidate.manifest.suite === expectation.suite &&
          candidate.manifest.run.attempt >= expectation.minimumAttempt,
      )
      if (matches.length === 0)
        throw new Error(`Missing expected Vitest suite: ${expectation.suite}`)
      const latestAttempt = Math.max(...matches.map((candidate) => candidate.manifest.run.attempt))
      const latest = matches.filter((candidate) => candidate.manifest.run.attempt === latestAttempt)
      return {
        candidate: latest[0]!,
        sources: [...new Set(latest.map((candidate) => candidate.source))].toSorted(),
      }
    })
}

function replaceOutput(
  outputDir: string,
  selected: readonly { candidate: Candidate; sources: SelectedVitestReport['sources'] }[],
): void {
  const parent = dirname(outputDir)
  mkdirSync(parent, { recursive: true })
  const temporary = mkdtempSync(join(parent, `.${basename(outputDir)}-`))
  const backup = join(parent, `.${basename(outputDir)}-backup-${randomUUID()}`)
  let backedUp = false
  try {
    for (const { candidate } of selected) {
      writeFileSync(join(temporary, `${candidate.manifest.suite}.json`), candidate.reportBytes, {
        flag: 'wx',
        mode: 0o600,
      })
    }
    if (existsSync(outputDir)) {
      if (!lstatSync(outputDir).isDirectory())
        throw new Error('Vitest report output must be a directory')
      renameSync(outputDir, backup)
      backedUp = true
    }
    try {
      renameSync(temporary, outputDir)
    } catch (error) {
      /* v8 ignore start -- an OS-level rename failure restores the already-tested backup path */
      if (backedUp) renameSync(backup, outputDir)
      backedUp = false
      throw error
      /* v8 ignore stop */
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    if (backedUp) rmSync(backup, { recursive: true, force: true })
  }
}

/**
 * Validates untrusted blob bundles and atomically publishes one newest report per expected suite.
 * The caller owns artifact transport; this function deliberately has no network or CI-provider API.
 */
export function prepareVitestReports(options: PrepareVitestReportsOptions): {
  readonly selected: readonly SelectedVitestReport[]
} {
  validateOptions(options)
  const candidates = [
    ...inspectSource(options.primaryDir, 'primary'),
    ...inspectSource(options.fallbackDir, 'fallback'),
  ]
  const selected = selectCandidates(candidates, options)
  replaceOutput(options.outputDir, selected)
  return {
    selected: selected.map(({ candidate, sources }) => ({
      suite: candidate.manifest.suite,
      attempt: candidate.manifest.run.attempt,
      sources,
    })),
  }
}
