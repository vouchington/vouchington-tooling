import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
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
const LOCK_ATTEMPTS = 20
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

function ensureLog(sessionId: string, directory: string): string {
  const path = logPath(sessionId, directory)
  mkdirSync(requireDirectory(directory), { recursive: true })
  appendFileSync(path, '', 'utf8')
  return path
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

function validEventCount(path: string): number {
  return readFileSync(path, 'utf8')
    .split('\n')
    .reduce((count, line) => {
      if (!line.trim()) return count
      try {
        return validEvent(JSON.parse(line)) ? count + 1 : count
      } catch {
        return count
      }
    }, 0)
}

function withLogLock(path: string, action: () => void): void {
  const lockPath = `${path}.lock`
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      const descriptor = openSync(lockPath, 'wx')
      try {
        action()
      } finally {
        closeSync(descriptor)
        unlinkSync(lockPath)
      }
      return
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
        /* v8 ignore next -- lock acquisition failures are platform errors that must propagate. */
        throw error
      Atomics.wait(lockWait, 0, 0, 5)
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
  const path = ensureLog(sessionId, options.directory)
  if (!classified) return
  const timestamp =
    typeof options.timestamp === 'function' ? options.timestamp() : options.timestamp
  withLogLock(path, () => {
    if (validEventCount(path) >= maxEvents) return
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
  const events: FrictionEvent[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (validEvent(value)) events.push(value)
    } catch {
      // Corrupt lines do not make the rest of a session's evidence unreadable.
    }
  }
  return events.length ? { status: 'events', events } : { status: 'empty' }
}
