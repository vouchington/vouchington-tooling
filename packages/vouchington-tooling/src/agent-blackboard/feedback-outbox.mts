import { canonicalFeedback, canonicalFeedbackEvent } from './feedback-canonical.mts'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { ensureOutboxDirectory } from './feedback-outbox-directory.mts'
import { withFileLock } from '../session-friction/lock.mts'
import { openLogFile, readLogContent, writeAll } from '../session-friction/log-file.mts'
import { validateFeedbackEnvelope } from './feedback-codec.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
import { isObject } from './snapshot-partition-guards.mts'
import type { FeedbackOutboxRecord, FeedbackOutboxStatus } from './feedback-types.mts'
const FEEDBACK_OUTBOX_MAX_RECORDS = 128
const FEEDBACK_OUTBOX_MAX_BYTES = 2_000_000
const RECORD_MAX_BYTES = 18_000
export function outboxDirectory(directory: string, create: boolean): string {
  if (typeof directory !== 'string' || directory.length > 4096 || !isAbsolute(directory))
    throw new Error('feedback outbox requires an absolute directory')
  const path = resolve(directory)
  ensureOutboxDirectory(path, create)
  return path
}
export function filename(record: FeedbackOutboxRecord): string {
  return `${createHash('sha256')
    .update(JSON.stringify([record.identity.sessionId, record.envelope.sourceEventId]))
    .digest('hex')}.json`
}
export function readRecord(path: string): { record: FeedbackOutboxRecord; bytes: number } {
  const descriptor = openLogFile(path, constants.O_RDONLY)
  try {
    const status = fstatSync(descriptor)
    const bytes = status.size
    if (bytes > RECORD_MAX_BYTES) throw new Error('feedback outbox record is too large')
    const value: unknown = JSON.parse(readLogContent(descriptor, RECORD_MAX_BYTES))
    if (
      !isObject(value) ||
      Object.keys(value).some((key) => !['identity', 'envelope'].includes(key))
    )
      throw new Error('invalid feedback outbox record')
    validateFeedbackIdentity(value.identity)
    validateFeedbackEnvelope(value.envelope)
    return { record: { identity: value.identity, envelope: value.envelope }, bytes }
  } finally {
    closeSync(descriptor)
  }
}
export function records(
  directory: string,
): Array<{ record: FeedbackOutboxRecord; bytes: number; path: string }> {
  const paths = readdirSync(directory).filter(
    (name) => !name.endsWith('.rejected') && !name.startsWith('.records.lock'),
  )
  if (paths.length > FEEDBACK_OUTBOX_MAX_RECORDS)
    throw new Error('feedback outbox capacity exceeded; unsent records retained')
  const result = paths.sort().map((name) => {
    if (!/^[a-f0-9]{64}\.json$/.test(name))
      throw new Error('feedback outbox contains an unresolved persistence file')
    const path = join(directory, name)
    const loaded = readRecord(path)
    if (filename(loaded.record) !== name)
      throw new Error('feedback outbox record identity does not match its path')
    return { ...loaded, path }
  })
  if (result.reduce((sum, item) => sum + item.bytes, 0) > FEEDBACK_OUTBOX_MAX_BYTES)
    throw new Error('feedback outbox byte capacity exceeded; unsent records retained')
  return result
}
export function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
export function feedbackOutboxStatus(directory: string): FeedbackOutboxStatus {
  const path = outboxDirectory(directory, false)
  if (!ensureOutboxDirectory(path, false)) return { status: 'empty', pendingCount: 0 }
  return withFileLock(join(path, '.records'), () => {
    const pendingCount = records(path).length
    return { status: pendingCount ? 'pending' : 'empty', pendingCount }
  })
}
export function listFeedbackOutbox(directory: string): FeedbackOutboxRecord[] {
  const path = outboxDirectory(directory, true)
  return withFileLock(join(path, '.records'), () => records(path).map((item) => item.record))
}
/** Reads the retained records without creating the outbox directory. */
export function readFeedbackOutbox(directory: string): FeedbackOutboxRecord[] {
  const path = outboxDirectory(directory, false)
  if (!ensureOutboxDirectory(path, false)) return []
  return withFileLock(join(path, '.records'), () => records(path).map((item) => item.record))
}
/**
 * Retains the record unless the same event is already retained, in which case that record stays:
 * the event is the session, `sourceEventId`, and content, and the earlier `timestamp` wins. The
 * returned record is the one to deliver.
 */
export function persistFeedbackOutbox(
  directory: string,
  record: FeedbackOutboxRecord,
): FeedbackOutboxRecord {
  validateFeedbackIdentity(record.identity)
  validateFeedbackEnvelope(record.envelope)
  const path = outboxDirectory(directory, true)
  return withFileLock(join(path, '.records'), () => {
    const current = records(path)
    const name = filename(record)
    const existing = current.find((item) => item.path === join(path, name))
    const serialized = JSON.stringify(record)
    if (existing) {
      if (
        canonicalFeedback(existing.record.identity) !== canonicalFeedback(record.identity) ||
        canonicalFeedbackEvent(existing.record.envelope) !== canonicalFeedbackEvent(record.envelope)
      )
        throw new Error('feedback source event conflicts with a retained unsent record')
      return existing.record
    }
    const bytes = Buffer.byteLength(serialized)
    if (
      bytes > RECORD_MAX_BYTES ||
      current.length >= FEEDBACK_OUTBOX_MAX_RECORDS ||
      current.reduce((sum, item) => sum + item.bytes, 0) + bytes > FEEDBACK_OUTBOX_MAX_BYTES
    )
      throw new Error('feedback outbox is full; unsent records retained')
    const temporary = join(path, `.persist-${randomUUID()}`)
    const descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      writeAll(descriptor, serialized)
      fsyncSync(descriptor)
    } catch (error) {
      closeSync(descriptor)
      try {
        unlinkSync(temporary)
      } catch {}
      throw error
    }
    closeSync(descriptor)
    try {
      renameSync(temporary, join(path, name))
      syncDirectory(path)
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {}
      throw error
    }
    return record
  })
}
export function removeFeedbackOutbox(
  directory: string,
  record: FeedbackOutboxRecord,
): {
  pendingCount: number
  cleanupDiagnostic?: 'outbox-cleanup-failed'
} {
  const path = outboxDirectory(directory, true)
  return withFileLock(join(path, '.records'), () => {
    const current = records(path)
    const existing = current.find((item) => item.path === join(path, filename(record)))
    if (!existing) return { pendingCount: current.length }
    if (canonicalFeedback(existing.record) !== canonicalFeedback(record))
      throw new Error('feedback outbox changed during delivery')
    try {
      unlinkSync(existing.path)
    } catch {
      return { pendingCount: current.length, cleanupDiagnostic: 'outbox-cleanup-failed' }
    }
    try {
      syncDirectory(path)
    } catch {
      return { pendingCount: current.length - 1, cleanupDiagnostic: 'outbox-cleanup-failed' }
    }
    return { pendingCount: current.length - 1 }
  })
}
