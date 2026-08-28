import {
  appendFileSync,
  chmodSync,
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
const EVENT_FIELD_MAX_LENGTH = 1_000
const lockWait = new Int32Array(new SharedArrayBuffer(4))

function requireDirectory(directory: string): string {
  if (!isAbsolute(directory)) throw new Error('session-friction log directory must be absolute')
  return directory
}

function eventLimit(maxEvents: number | undefined): number {
  const limit = maxEvents ?? FRICTION_LOG_MAX_EVENTS
  if (!Number.isInteger(limit) || limit < 1) throw new Error('maxEvents must be a positive integer')
  return Math.min(limit, FRICTION_LOG_MAX_EVENTS)
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
    const buffer = Buffer.alloc(LOG_MAX_BYTES + 1)
    const length = readSync(descriptor, buffer, 0, buffer.length, 0)
    if (length > LOG_MAX_BYTES) throw new Error('session-friction log is too large')
    return buffer.toString('utf8', 0, length)
  } finally {
    closeSync(descriptor)
  }
}

function validEventCount(content: string, limit: number): number {
  let count = 0
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      if (validEvent(JSON.parse(line))) count++
    } catch {}
    if (count >= limit) break
  }
  return count
}

function removeStaleLock(lockPath: string): boolean {
  try {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs
    const fresh = ageMs > -1_000 && ageMs < STALE_LOCK_AGE_MS
    const owner = Number(readFileSync(lockPath, 'utf8'))
    let ownerDead = false
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0)
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'))
          /* v8 ignore next -- permission errors conservatively preserve a potentially live lock. */
          return false
        ownerDead = true
      }
    }
    if (!ownerDead && fresh) return false
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
      descriptor = openSync(lockPath, 'wx', 0o600)
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
  const directory = requireDirectory(options.directory)
  mkdirSync(directory, { mode: 0o700, recursive: true })
  try {
    chmodSync(directory, 0o700)
  } catch {}
  const timestamp =
    typeof options.timestamp === 'function' ? options.timestamp() : options.timestamp
  withLogLock(path, () => {
    appendFileSync(path, '', { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(path, 0o600)
    } catch {}
    if (!classified) return
    const content = readLogContent(path)
    if (validEventCount(content, maxEvents) >= maxEvents) return
    const event = {
      ...classified,
      commandPrefix: normalizeAuditText(classified.commandPrefix),
      detail: normalizeAuditText(classified.detail),
      timestamp:
        normalizeAuditText(timestamp ?? new Date().toISOString()).slice(
          0,
          EVENT_FIELD_MAX_LENGTH,
        ) || new Date().toISOString(),
    }
    /* v8 ignore next -- normalized classified fields satisfy validEvent defensively. */
    if (!validEvent(event)) return
    const prefix = content && !content.endsWith('\n') ? '\n' : ''
    const addition = `${prefix}${JSON.stringify(event)}\n`
    if (statSync(path).size + Buffer.byteLength(addition) > LOG_MAX_BYTES)
      throw new Error('session-friction log is too large')
    appendFileSync(path, addition, 'utf8')
  })
}

export function readFrictionLog(
  sessionId: string,
  options: FrictionLogOptions,
): FrictionLogReadResult {
  const path = logPath(sessionId, options.directory)
  if (!existsSync(requireDirectory(options.directory))) return { status: 'absent' }
  return withLogLock(path, () => {
    if (!existsSync(path)) return { status: 'absent' }
    const events: FrictionEvent[] = []
    for (const line of readLogContent(path).split('\n')) {
      if (!line.trim()) continue
      try {
        const value: unknown = JSON.parse(line)
        if (validEvent(value)) events.push(value)
      } catch {}
    }
    return events.length ? { status: 'events', events } : { status: 'empty' }
  })
}
