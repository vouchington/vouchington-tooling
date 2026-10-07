import { readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from '../session-friction/lock.mts'
import { canonicalFeedback } from './feedback-canonical.mts'
import { ensureOutboxDirectory } from './feedback-outbox-directory.mts'
import {
  filename,
  outboxDirectory,
  readRecord,
  records,
  syncDirectory,
} from './feedback-outbox.mts'
import type { FeedbackOutboxRecord } from './feedback-types.mts'

const rejectedName = (record: FeedbackOutboxRecord) =>
  filename(record).replace(/\.json$/, '.rejected')

/**
 * Moves a permanently rejected record out of the pending set into the rejected area of the outbox.
 * The content is kept, never deleted, so a corrected retry of the same event is accepted while the
 * rejected note stays inspectable. A record that is no longer pending is left alone.
 */
export function rejectFeedbackOutbox(directory: string, record: FeedbackOutboxRecord): void {
  const path = outboxDirectory(directory, true)
  withFileLock(join(path, '.records'), () => {
    const existing = records(path).find((item) => item.path === join(path, filename(record)))
    if (!existing) return
    if (canonicalFeedback(existing.record) !== canonicalFeedback(record))
      throw new Error('feedback outbox changed during delivery')
    renameSync(existing.path, join(path, rejectedName(record)))
    syncDirectory(path)
  })
}

/** Reads the rejected records without creating the outbox directory. */
export function readRejectedFeedbackOutbox(directory: string): FeedbackOutboxRecord[] {
  const path = outboxDirectory(directory, false)
  if (!ensureOutboxDirectory(path, false)) return []
  return withFileLock(join(path, '.records'), () =>
    readdirSync(path)
      .filter((name) => /^[a-f0-9]{64}\.rejected$/.test(name))
      .sort()
      .map((name) => readRecord(join(path, name)).record),
  )
}
