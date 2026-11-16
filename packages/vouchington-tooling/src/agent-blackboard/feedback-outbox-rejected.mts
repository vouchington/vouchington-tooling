import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from '../private-files/lock.mts'
import { canonicalFeedback } from './feedback-canonical.mts'
import { ensureOutboxDirectory } from './feedback-outbox-directory.mts'
import type { FeedbackRejection } from './feedback-failure.mts'
import { readRecord } from './feedback-outbox-read.mts'
import { writeOutboxFile } from './feedback-outbox-write.mts'
import { filename, outboxDirectory, records, syncDirectory } from './feedback-outbox.mts'
import type { FeedbackOutboxRecord } from './feedback-types.mts'

const REJECTED = /^[a-f0-9]{64}\.rejected$/
const rejectedName = (record: FeedbackOutboxRecord) =>
  filename(record).replace(/\.json$/, '.rejected')

/**
 * Moves a permanently rejected record out of the pending set into the rejected area of the outbox,
 * with the rejection diagnostic stored beside it. The content is kept, never deleted, so a corrected
 * retry of the same event is accepted while the rejected note stays inspectable. A record that is
 * no longer pending is left alone. The caller must hold the outbox lock.
 */
export function moveToRejected(
  path: string,
  record: FeedbackOutboxRecord,
  rejection: FeedbackRejection,
): boolean {
  const existing = records(path).find((item) => item.path === join(path, filename(record)))
  if (!existing) return false
  if (canonicalFeedback(existing.record) !== canonicalFeedback(record))
    throw new Error('feedback outbox changed during delivery')
  writeOutboxFile(path, rejectedName(record), { ...existing.record, rejection })
  unlinkSync(existing.path)
  syncDirectory(path)
  return true
}

export function rejectFeedbackOutbox(
  directory: string,
  record: FeedbackOutboxRecord,
  rejection: FeedbackRejection,
): void {
  const path = outboxDirectory(directory, true)
  withFileLock(join(path, '.records'), () => void moveToRejected(path, record, rejection))
}

/** Reads the rejected records and their stored diagnostics without creating the outbox directory. */
export function readRejectedDetails(
  directory: string,
): Array<{ record: FeedbackOutboxRecord; rejection?: FeedbackRejection }> {
  const path = outboxDirectory(directory, false)
  if (!ensureOutboxDirectory(path, false)) return []
  return withFileLock(join(path, '.records'), () =>
    readdirSync(path)
      .filter((name) => REJECTED.test(name))
      .sort()
      .map((name) => readRecord(join(path, name)))
      .map(({ record, rejection }) => ({ record, ...(rejection ? { rejection } : {}) })),
  )
}

export function readRejectedFeedbackOutbox(directory: string): FeedbackOutboxRecord[] {
  return readRejectedDetails(directory).map((item) => item.record)
}

/** Deletes rejected records last written at least `olderThanDays` days ago; 0 deletes them all. */
export function pruneRejectedFeedbackOutbox(directory: string, olderThanDays: number): number {
  const path = outboxDirectory(directory, false)
  if (!ensureOutboxDirectory(path, false)) return 0
  const cutoff = Date.now() - olderThanDays * 86_400_000
  return withFileLock(join(path, '.records'), () => {
    const old = readdirSync(path).filter(
      (name) => REJECTED.test(name) && statSync(join(path, name)).mtimeMs <= cutoff,
    )
    for (const name of old) unlinkSync(join(path, name))
    if (old.length > 0) syncDirectory(path)
    return old.length
  })
}
