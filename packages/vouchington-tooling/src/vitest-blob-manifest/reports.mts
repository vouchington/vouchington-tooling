import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { VITEST_SUITE_PATTERN } from './index.mts'
import {
  inspectVitestReportSource,
  type Candidate,
  type RejectedVitestReportSource,
  type VitestReportSource,
} from './reports-source.mts'

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
  readonly sources: readonly VitestReportSource[]
}
export type { RejectedVitestReportSource, VitestReportRejectionReason } from './reports-source.mts'

function validateOptions(options: PrepareVitestReportsOptions): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository))
    throw new Error('Invalid Vitest repository')
  if (!/^[0-9a-f]{40}$/.test(options.revision)) throw new Error('Invalid Vitest revision')
  if (
    !/^[1-9][0-9]*$/.test(options.run.id) ||
    !Number.isSafeInteger(options.run.currentAttempt) ||
    options.run.currentAttempt < 1
  )
    throw new Error('Invalid Vitest run')
  for (const expectation of options.expectedSuites) {
    if (!VITEST_SUITE_PATTERN.test(expectation.suite))
      throw new Error('Invalid expected Vitest suite')
    if (
      !Number.isSafeInteger(expectation.minimumAttempt) ||
      expectation.minimumAttempt < 1 ||
      expectation.minimumAttempt > options.run.currentAttempt
    )
      throw new Error('Invalid expected Vitest suite attempt')
  }
  if (
    new Set(options.expectedSuites.map((expectation) => expectation.suite)).size !==
    options.expectedSuites.length
  )
    throw new Error('Expected Vitest suites must be unique')
}
function selectionError(message: string, rejected: readonly RejectedVitestReportSource[]): Error {
  const context = rejected.map(({ source, reason }) => `${source}=${reason}`).join(', ')
  return new Error(context ? `${message}; rejected sources: ${context}` : message)
}
function select(
  candidates: readonly Candidate[],
  options: PrepareVitestReportsOptions,
  rejected: readonly RejectedVitestReportSource[],
) {
  const first = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const key = `${candidate.manifest.suite}\0${candidate.manifest.run.attempt}`,
      prior = first.get(key)
    if (
      prior &&
      (!prior.manifestBytes.equals(candidate.manifestBytes) ||
        !prior.reportBytes.equals(candidate.reportBytes))
    )
      throw selectionError(
        `Conflicting Vitest blobs for ${candidate.manifest.suite} attempt ${candidate.manifest.run.attempt}`,
        rejected,
      )
    first.set(key, prior ?? candidate)
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
        throw selectionError(`Missing expected Vitest suite: ${expectation.suite}`, rejected)
      const attempt = Math.max(...matches.map((candidate) => candidate.manifest.run.attempt))
      const latest = matches.filter((candidate) => candidate.manifest.run.attempt === attempt)
      return {
        candidate: latest[0]!,
        sources: [...new Set(latest.map((candidate) => candidate.source))].toSorted(),
      }
    })
}
function replaceOutput(outputDir: string, selected: readonly { candidate: Candidate }[]): void {
  const parent = dirname(outputDir)
  mkdirSync(parent, { recursive: true })
  const temporary = mkdtempSync(join(parent, `.${basename(outputDir)}-`)),
    backup = join(parent, `.${basename(outputDir)}-backup-${randomUUID()}`)
  let backedUp = false,
    published = false
  try {
    for (const { candidate } of selected)
      writeFileSync(join(temporary, `${candidate.manifest.suite}.json`), candidate.reportBytes, {
        flag: 'wx',
        mode: 0o600,
      })
    if (existsSync(outputDir)) {
      if (!lstatSync(outputDir).isDirectory())
        throw new Error('Vitest report output must be a directory')
      renameSync(outputDir, backup)
      backedUp = true
    }
    try {
      renameSync(temporary, outputDir)
      published = true
    } catch (error) {
      if (backedUp) {
        try {
          renameSync(backup, outputDir)
          backedUp = false
        } catch (restoreError) {
          throw new AggregateError([error, restoreError], 'Vitest report output rollback failed')
        }
      }
      throw error
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    if (backedUp && published) rmSync(backup, { recursive: true, force: true })
  }
}
/** Validates untrusted blob bundles and atomically publishes one newest report per expected suite. */
export function prepareVitestReports(options: PrepareVitestReportsOptions): {
  readonly selected: readonly SelectedVitestReport[]
  readonly rejectedSources: readonly RejectedVitestReportSource[]
} {
  validateOptions(options)
  const inspected = [
    inspectVitestReportSource(options.primaryDir, 'primary', options),
    inspectVitestReportSource(options.fallbackDir, 'fallback', options),
  ]
  const rejectedSources = inspected.flatMap(({ rejected }) => (rejected ? [rejected] : []))
  const selected = select(
    inspected.flatMap(({ candidates }) => candidates),
    options,
    rejectedSources,
  )
  replaceOutput(options.outputDir, selected)
  return {
    selected: selected.map(({ candidate, sources }) => ({
      suite: candidate.manifest.suite,
      attempt: candidate.manifest.run.attempt,
      sources,
    })),
    rejectedSources,
  }
}
