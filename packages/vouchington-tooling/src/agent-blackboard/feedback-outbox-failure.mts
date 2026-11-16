import { join } from 'node:path'
import { withFileLock } from '../private-files/lock.mts'
import { canonicalFeedback } from './feedback-canonical.mts'
import { ensureOutboxDirectory } from './feedback-outbox-directory.mts'
import {
  MAX_ATTEMPTS,
  QUARANTINE_ATTEMPTS,
  isTransientCause,
  type FeedbackCause,
  type FeedbackFailure,
} from './feedback-failure.mts'
import { moveToRejected } from './feedback-outbox-rejected.mts'
import { writeOutboxFile } from './feedback-outbox-write.mts'
import { filename, outboxDirectory, records, syncDirectory } from './feedback-outbox.mts'
import type { FeedbackOutboxRecord } from './feedback-types.mts'

export type FeedbackFailureReport = FeedbackFailure & { sourceEventId: string }

/**
 * Persists one failed flush attempt with the record. The attempt count continues only while the
 * cause repeats. A record-specific (non-transient) cause on {@link QUARANTINE_ATTEMPTS} consecutive
 * attempts moves the record to the rejected area with that cause as its diagnostic.
 */
export function recordFeedbackFailure(
  directory: string,
  record: FeedbackOutboxRecord,
  cause: FeedbackCause,
): { failure: FeedbackFailure; quarantined: boolean } {
  const path = outboxDirectory(directory, true)
  return withFileLock(join(path, '.records'), () => {
    const existing = records(path).find((item) => item.path === join(path, filename(record)))
    const attempts =
      existing?.failure?.cause === cause.cause
        ? Math.min(existing.failure.attempts + 1, MAX_ATTEMPTS)
        : 1
    const failure = { ...cause, attempts }
    if (!existing) return { failure, quarantined: false }
    if (canonicalFeedback(existing.record) !== canonicalFeedback(record))
      throw new Error('feedback outbox changed during delivery')
    if (!isTransientCause(cause.cause) && attempts >= QUARANTINE_ATTEMPTS) {
      moveToRejected(path, record, { ...failure, diagnostic: 'delivery-quarantined' })
      return { failure, quarantined: true }
    }
    writeOutboxFile(path, filename(record), { ...record, failure })
    syncDirectory(path)
    return { failure, quarantined: false }
  })
}

/** Every pending record's last failed flush, without creating the outbox directory. */
export function readFeedbackFailures(directory: string): FeedbackFailureReport[] {
  const path = outboxDirectory(directory, false)
  if (!ensureOutboxDirectory(path, false)) return []
  return withFileLock(join(path, '.records'), () =>
    records(path).flatMap(({ record, failure }) =>
      failure ? [{ sourceEventId: record.envelope.sourceEventId, ...failure }] : [],
    ),
  )
}
