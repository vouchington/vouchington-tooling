import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createHash } from 'node:crypto'

import { classifyFrictionObservation } from './classify.mts'
import { isSafeAuditText, normalizeAuditText } from './text.mts'
import type {
  FrictionEvent,
  FrictionLogOptions,
  FrictionLogReadResult,
  FrictionObservation,
} from './types.mts'

export const FRICTION_LOG_MAX_EVENTS = 500
const SESSION_ID_MAX_LENGTH = 4096
const LOCK_ATTEMPTS = 200
const STALE_LOCK_AGE_MS = 30_000
const LOG_MAX_BYTES = 2_000_000
const lockWait = new Int32Array(new SharedArrayBuffer(4))

function requireDirectory(directory: string): string {
  if (!isAbsolute(directory)) throw new Error('session-friction log directory must be absolute')
  return directory
}

function eventLimit(maxEvents: number | undefined): number {
  const limit = maxEvents ?? FRICTION_LOG_MAX_EVENTS
  if (!Number.isInteger(limit) || limit < 1) throw new Error('maxEvents must be a positive integer')
  return limit
}

function sanitizeSessionId(sessionId: string): string {
  if (normalizeAuditText(sessionId) === '') throw new Error('sessionId must be non-empty')
  if (sessionId.length > SESSION_ID_MAX_LENGTH) throw new Error('sessionId is too long')
  return createHash('sha256').update(sessionId).digest('hex')
}

function logPath(sessionId: string, directory: string): string {
  return join(requireDirectory(directory), `${sanitizeSessionId(sessionId)}.jsonl`)
}

function validEvent(value: unknown): value is FrictionEvent {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    (record.kind === 'sandbox-escalation' || record.kind === 'sandbox-failure') &&
    isSafeAuditText(record.timestamp) &&
    isSafeAuditText(record.commandPrefix) &&
    isSafeAuditText(record.detail)
  )
}

function readLogContent(path: string): string {
  const descriptor = openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(LOG_MAX_BYTES + 1)
    const length = readSync(descriptor, buffer, 0, buffer.length, 0)
    if (length > LOG_MAX_BYTES) throw new Error('session-friction log is too large')
    return buffer.toString('utf8', 0, length)
  } finally {
    closeSync(descriptor)
  }
}

function validEventCount(path: string, limit: number): number {
  let count = 0
  for (const line of readLogContent(path).split('\n')) {
    if (!line.trim()) continue
    try {
      if (validEvent(JSON.parse(line))) count++
    } catch {
      // Malformed lines do not count toward the event limit.
    }
    if (count >= limit) break
  }
  return count
}

function removeStaleLock(lockPath: string): boolean {
  try {
    const owner = Number(readFileSync(lockPath, 'utf8'))
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0)
        return false
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'))
          /* v8 ignore next -- permission errors conservatively preserve a potentially live lock. */
          return false
      }
    } else if (Date.now() - statSync(lockPath).mtimeMs < STALE_LOCK_AGE_MS) return false
    unlinkSync(lockPath)
    return true
  } catch {
    /* v8 ignore next -- a concurrently removed or unreadable lock is retried by the caller. */
    return false
  }
}

function withLogLock<Result>(path: string, action: () => Result): Result {
  const lockPath = `${path}.lock`
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx')
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
        /* v8 ignore next -- lock acquisition failures are platform errors that must propagate. */
        throw error
      if (removeStaleLock(lockPath)) continue
      Atomics.wait(lockWait, 0, 0, 5)
      continue
    }
    try {
      writeFileSync(descriptor, String(process.pid))
      return action()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
  throw new Error('could not acquire session-friction log lock')
}

export function recordFriction(
  sessionId: string,
  observation: FrictionObservation,
  options: FrictionLogOptions & { timestamp?: string | (() => string) },
): void {
  const maxEvents = eventLimit(options.maxEvents)
  const classified = classifyFrictionObservation(observation)
  const path = logPath(sessionId, options.directory)
  mkdirSync(requireDirectory(options.directory), { recursive: true })
  const timestamp =
    typeof options.timestamp === 'function' ? options.timestamp() : options.timestamp
  withLogLock(path, () => {
    appendFileSync(path, '', 'utf8')
    if (!classified || validEventCount(path, maxEvents) >= maxEvents) return
    const event = {
      ...classified,
      commandPrefix: normalizeAuditText(classified.commandPrefix),
      detail: normalizeAuditText(classified.detail),
      timestamp:
        normalizeAuditText(timestamp ?? new Date().toISOString()) || new Date().toISOString(),
    }
    if (validEvent(event)) appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8')
  })
}

export function readFrictionLog(
  sessionId: string,
  options: FrictionLogOptions,
): FrictionLogReadResult {
  const path = logPath(sessionId, options.directory)
  if (!existsSync(path)) return { status: 'absent' }
  return withLogLock(path, () => {
    if (!existsSync(path)) return { status: 'absent' }
    const events: FrictionEvent[] = []
    for (const line of readLogContent(path).split('\n')) {
      if (!line.trim()) continue
      try {
        const value: unknown = JSON.parse(line)
        if (validEvent(value)) events.push(value)
      } catch {
        // Corrupt lines do not make the rest of a session's evidence unreadable.
      }
    }
    return events.length ? { status: 'events', events } : { status: 'empty' }
  })
}
