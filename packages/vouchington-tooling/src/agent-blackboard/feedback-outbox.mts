import { canonicalFeedback } from './feedback-canonical.mts'
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
import { ensurePrivateDirectory } from '../session-friction/directory.mts'
import { withFileLock } from '../session-friction/lock.mts'
import { openLogFile, readLogContent, writeAll } from '../session-friction/log-file.mts'
import { validateFeedbackEnvelope } from './feedback-codec.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
import { isObject } from './snapshot-partition-guards.mts'
import type { FeedbackOutboxRecord, FeedbackOutboxStatus } from './feedback-types.mts'
const FEEDBACK_OUTBOX_MAX_RECORDS = 128
const FEEDBACK_OUTBOX_MAX_BYTES = 2_000_000
const RECORD_MAX_BYTES = 18_000
function outboxDirectory(directory: string, create: boolean): string {
  if (typeof directory !== 'string' || directory.length > 4096 || !isAbsolute(directory))
    throw new Error('feedback outbox requires an absolute private directory')
  const path = resolve(directory)
  ensurePrivateDirectory(path, create)
  return path
}
function filename(record: FeedbackOutboxRecord): string {
  return `${createHash('sha256')
    .update(JSON.stringify([record.identity.sessionId, record.envelope.sourceEventId]))
    .digest('hex')}.json`
}
function readRecord(path: string): { record: FeedbackOutboxRecord; bytes: number } {
  const descriptor = openLogFile(path, constants.O_RDONLY)
  try {
    const status = fstatSync(descriptor)
    if ((status.mode & 0o777) !== 0o600 || status.uid !== process.geteuid?.())
      throw new Error('feedback outbox record must be private and owned by caller')
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
function records(
  directory: string,
): Array<{ record: FeedbackOutboxRecord; bytes: number; path: string }> {
  const paths = readdirSync(directory).filter(
    (name) => name !== '.records.lock' && name !== '.records.lock.reap',
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
function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
export function feedbackOutboxStatus(directory: string): FeedbackOutboxStatus {
  const path = outboxDirectory(directory, false)
  if (!ensurePrivateDirectory(path, false)) return { status: 'empty', pendingCount: 0 }
  return withFileLock(join(path, '.records'), () => {
    const pendingCount = records(path).length
    return { status: pendingCount ? 'pending' : 'empty', pendingCount }
  })
}
export function listFeedbackOutbox(directory: string): FeedbackOutboxRecord[] {
  const path = outboxDirectory(directory, true)
  return withFileLock(join(path, '.records'), () => records(path).map((item) => item.record))
}
export function persistFeedbackOutbox(directory: string, record: FeedbackOutboxRecord): number {
  validateFeedbackIdentity(record.identity)
  validateFeedbackEnvelope(record.envelope)
  const path = outboxDirectory(directory, true)
  return withFileLock(join(path, '.records'), () => {
    const current = records(path)
    const name = filename(record)
    const existing = current.find((item) => item.path === join(path, name))
    const serialized = JSON.stringify(record)
    if (existing) {
      if (canonicalFeedback(existing.record) !== canonicalFeedback(record))
        throw new Error('feedback source event conflicts with a retained unsent record')
      return current.length
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
    } finally {
      closeSync(descriptor)
    }
    try {
      renameSync(temporary, join(path, name))
      syncDirectory(path)
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {}
      throw error
    }
    return current.length + 1
  })
}
export function removeFeedbackOutbox(directory: string, record: FeedbackOutboxRecord): number {
  const path = outboxDirectory(directory, true)
  return withFileLock(join(path, '.records'), () => {
    const current = records(path)
    const existing = current.find((item) => item.path === join(path, filename(record)))
    if (!existing) return current.length
    if (canonicalFeedback(existing.record) !== canonicalFeedback(record))
      throw new Error('feedback outbox changed during delivery')
    unlinkSync(existing.path)
    syncDirectory(path)
    return current.length - 1
  })
}
