import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  inspectVitestBlobBundle,
  VITEST_BLOB_MANIFEST_FILENAME,
  VITEST_SUITE_PATTERN,
  type InspectedVitestBlobBundle,
} from './index.mts'
import { VitestBlobBundleError } from './bundle-error.mts'

export type VitestReportSource = 'primary' | 'fallback'
export type VitestReportRejectionReason =
  | 'root-not-directory'
  | 'invalid-archive'
  | 'unexpected-entry'
  | 'invalid-bundle'
  | 'identity-mismatch'
  | 'future-attempt'
  | 'intra-source-conflict'
  | 'unexpected-current-attempt-suite'
export interface RejectedVitestReportSource {
  readonly source: VitestReportSource
  readonly reason: VitestReportRejectionReason
}
export type Candidate = InspectedVitestBlobBundle & { readonly source: VitestReportSource }
type SourceOptions = {
  readonly repository: string
  readonly revision: string
  readonly run: { readonly id: string; readonly currentAttempt: number }
  readonly expectedSuites: readonly { readonly suite: string }[]
}

class SourceFailure extends Error {
  constructor(readonly reason: VitestReportRejectionReason) {
    super(reason)
  }
}
function bundle(root: string, source: VitestReportSource): Candidate[] {
  const entries = readdirSync(root, { withFileTypes: true })
  if (entries.length === 0) return []
  if (entries.some((entry) => entry.name === VITEST_BLOB_MANIFEST_FILENAME)) {
    try {
      return [{ ...inspectVitestBlobBundle(root), source }]
    } catch (error) {
      if (error instanceof VitestBlobBundleError) throw new SourceFailure('invalid-bundle')
      throw error
    }
  }
  if (
    entries.some(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('.invalid-') &&
        VITEST_SUITE_PATTERN.test(entry.name.slice('.invalid-'.length)),
    )
  )
    throw new SourceFailure('invalid-archive')
  if (entries.some((entry) => !entry.isDirectory())) throw new SourceFailure('unexpected-entry')
  try {
    return entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({ ...inspectVitestBlobBundle(join(root, entry.name)), source }))
  } catch (error) {
    if (error instanceof VitestBlobBundleError) throw new SourceFailure('invalid-bundle')
    throw error
  }
}
function validate(candidates: readonly Candidate[], options: SourceOptions): void {
  const expected = new Set(options.expectedSuites.map((expectation) => expectation.suite))
  const first = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const { manifest } = candidate
    if (
      manifest.repository !== options.repository ||
      manifest.revision !== options.revision ||
      manifest.run.id !== options.run.id
    )
      throw new SourceFailure('identity-mismatch')
    if (manifest.run.attempt > options.run.currentAttempt) throw new SourceFailure('future-attempt')
    if (!expected.has(manifest.suite) && manifest.run.attempt === options.run.currentAttempt)
      throw new SourceFailure('unexpected-current-attempt-suite')
    const key = `${manifest.suite}\0${manifest.run.attempt}`,
      prior = first.get(key)
    if (
      prior &&
      (!prior.manifestBytes.equals(candidate.manifestBytes) ||
        !prior.reportBytes.equals(candidate.reportBytes))
    )
      throw new SourceFailure('intra-source-conflict')
    first.set(key, prior ?? candidate)
  }
}
export function inspectVitestReportSource(
  root: string,
  source: VitestReportSource,
  options: SourceOptions,
): { readonly candidates: readonly Candidate[]; readonly rejected?: RejectedVitestReportSource } {
  let metadata
  try {
    metadata = lstatSync(root)
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return { candidates: [] }
    throw error
  }
  if (!metadata.isDirectory())
    return { candidates: [], rejected: { source, reason: 'root-not-directory' } }
  try {
    const candidates = bundle(root, source)
    validate(candidates, options)
    return { candidates }
  } catch (error) {
    if (error instanceof SourceFailure)
      return { candidates: [], rejected: { source, reason: error.reason } }
    throw error
  }
}
