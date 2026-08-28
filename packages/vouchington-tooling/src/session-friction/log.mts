import { closeSync, constants, fchmodSync, fstatSync, openSync, readSync, writeSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

import { classifyFrictionObservation } from './classify.mts'
import { ensurePrivateDirectory } from './directory.mts'
import { withFileLock } from './lock.mts'
import { isSafeAuditText, normalizeAuditText } from './text.mts'
import type {
  FrictionEvent,
  FrictionLogOptions,
  FrictionLogReadResult,
  FrictionObservation,
} from './types.mts'

export const FRICTION_LOG_MAX_EVENTS = 500
const SESSION_ID_MAX_LENGTH = 4096
const LOG_MAX_BYTES = 2_000_000
const EVENT_FIELD_MAX_LENGTH = 1_000

function requireDirectory(directory: string): string {
  if (!isAbsolute(directory)) throw new Error('session-friction log directory must be absolute')
  return resolve(directory)
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

function openLogFile(path: string, flags: number): number {
  let descriptor: number
  try {
    descriptor = openSync(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ELOOP' || error.code === 'EISDIR')
    )
      throw new Error('session-friction log must be a regular file')
    throw error
  }
  try {
    if (!fstatSync(descriptor).isFile())
      throw new Error('session-friction log must be a regular file')
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

function readLogContent(descriptor: number): string {
  if (fstatSync(descriptor).size > LOG_MAX_BYTES)
    throw new Error('session-friction log is too large')
  const buffer = Buffer.alloc(LOG_MAX_BYTES + 1)
  let length = 0
  while (length < buffer.length) {
    const bytes = readSync(descriptor, buffer, length, buffer.length - length, length)
    if (bytes === 0) break
    length += bytes
  }
  /* v8 ignore next -- detects external growth after the descriptor size check. */
  if (length > LOG_MAX_BYTES) throw new Error('session-friction log is too large')
  return buffer.subarray(0, length).toString('utf8')
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

export function recordFriction(
  sessionId: string,
  observation: FrictionObservation,
  options: FrictionLogOptions & { timestamp?: string | (() => string) },
): void {
  const maxEvents = eventLimit(options.maxEvents)
  const classified = classifyFrictionObservation(observation)
  const path = logPath(sessionId, options.directory)
  ensurePrivateDirectory(requireDirectory(options.directory), true)
  const timestamp =
    typeof options.timestamp === 'function' ? options.timestamp() : options.timestamp
  withFileLock(path, () => {
    const descriptor = openLogFile(path, constants.O_CREAT | constants.O_RDWR | constants.O_APPEND)
    try {
      fchmodSync(descriptor, 0o600)
      if (!classified) return
      const content = readLogContent(descriptor)
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
      if (fstatSync(descriptor).size + Buffer.byteLength(addition) > LOG_MAX_BYTES)
        throw new Error('session-friction log is too large')
      writeSync(descriptor, addition)
    } finally {
      closeSync(descriptor)
    }
  })
}

export function readFrictionLog(
  sessionId: string,
  options: FrictionLogOptions,
): FrictionLogReadResult {
  const path = logPath(sessionId, options.directory)
  if (!ensurePrivateDirectory(requireDirectory(options.directory), false))
    return { status: 'absent' }
  try {
    return withFileLock(path, () => {
      const descriptor = openLogFile(path, constants.O_RDONLY)
      try {
        const events: FrictionEvent[] = []
        for (const line of readLogContent(descriptor).split('\n')) {
          if (!line.trim()) continue
          try {
            const value: unknown = JSON.parse(line)
            if (validEvent(value)) events.push(value)
          } catch {}
        }
        return events.length ? { status: 'events', events } : { status: 'empty' }
      } finally {
        closeSync(descriptor)
      }
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return { status: 'absent' }
    throw error
  }
}
