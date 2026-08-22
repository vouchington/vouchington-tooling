import { appendFileSync } from 'node:fs'

/**
 * Transport exhaustion guards for a coverage pair and a Vitest blob, plus the
 * `$GITHUB_OUTPUT` writer producers use when the upload exit code is not the blob signal.
 */

export type StepOutcome = 'success' | 'failure' | 'cancelled' | 'skipped'

const STEP_OUTCOMES: ReadonlySet<string> = new Set<StepOutcome>([
  'success',
  'failure',
  'cancelled',
  'skipped',
])

/**
 * CLI argv values arrive as plain strings (or `undefined` when a positional arg was omitted); this
 * narrows to `StepOutcome` so a caller can validate a step-outcome argument without an unchecked
 * `as` cast.
 */
export function isStepOutcome(value: string | undefined): value is StepOutcome {
  return value !== undefined && STEP_OUTCOMES.has(value)
}

export function assertCoverageTransportOutcome(
  suite: string,
  primary: StepOutcome,
  artifactAttempt1: StepOutcome,
  artifactAttempt2: StepOutcome,
  emit: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): boolean {
  const primarySucceeded = primary === 'success'
  const artifactSucceeded = artifactAttempt1 === 'success' || artifactAttempt2 === 'success'
  if (primarySucceeded && artifactSucceeded) return true
  if (primarySucceeded) {
    emit(
      `::warning::Coverage persisted only to S3 for suite=${suite}; GitHub artifact fallback is degraded.`,
    )
    return true
  }
  if (artifactSucceeded) {
    emit(
      `::warning::Coverage persisted only to GitHub artifacts for suite=${suite}; S3 primary is degraded.`,
    )
    return true
  }
  emit(
    `::error::COVERAGE_TRANSPORT_EXHAUSTED suite=${suite} Neither S3 nor GitHub artifacts persisted the coverage pair.`,
  )
  return false
}

export type BlobPrimaryState = 'true' | 'false' | 'skipped'

const BLOB_PRIMARY_STATES: ReadonlySet<string> = new Set<BlobPrimaryState>([
  'true',
  'false',
  'skipped',
])

export function isBlobPrimaryState(value: string | undefined): value is BlobPrimaryState {
  return value !== undefined && BLOB_PRIMARY_STATES.has(value)
}

/**
 * Sibling to `assertCoverageTransportOutcome` for the Vitest blob. `true`/`false` are the S3
 * upload step's `blob` output; `skipped` means that step never ran. GitHub fallback is always
 * attempted when enabled — workflows must not gate it on `blob != 'true'`.
 */
export function assertCoverageTransportBlobOutcome(
  suite: string,
  primaryPersisted: BlobPrimaryState,
  artifactAttempt1: StepOutcome,
  artifactAttempt2: StepOutcome,
  emit: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): boolean {
  const artifactSucceeded = artifactAttempt1 === 'success' || artifactAttempt2 === 'success'
  if (primaryPersisted === 'true') {
    if (!artifactSucceeded) {
      emit(
        `::warning::Vitest blob persisted only to S3 for suite=${suite}; GitHub artifact fallback is degraded.`,
      )
    }
    return true
  }
  if (artifactSucceeded) {
    if (primaryPersisted === 'false') {
      emit(
        `::warning::Vitest blob persisted only to GitHub artifacts for suite=${suite}; S3 primary is degraded.`,
      )
    }
    return true
  }
  emit(
    `::error::COVERAGE_TRANSPORT_BLOB_EXHAUSTED suite=${suite} Neither S3 nor GitHub artifacts persisted the vitest blob.`,
  )
  return false
}

export type AppendOutput = (path: string, data: string) => void

/**
 * Writes `blob=true|false` to `$GITHUB_OUTPUT` for outcome reporting. GitHub-fallback blob upload
 * must always be attempted when enabled; do not gate it on this signal. The upload subcommand's
 * exit code tracks the coverage pair, not the blob. A no-op outside CI (`githubOutputPath` unset).
 */
export function writeUploadOutcomeOutput(
  outcome: { readonly blob: boolean },
  githubOutputPath: string | undefined,
  appendOutput: AppendOutput = appendFileSync,
): void {
  if (githubOutputPath) appendOutput(githubOutputPath, `blob=${String(outcome.blob)}\n`)
}
