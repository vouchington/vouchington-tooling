import { closeSync, constants, fchmodSync, fstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { classifyFrictionObservation } from './classify.mts'
import { ensurePrivateDirectory } from './directory.mts'
import { withFileLock } from './lock.mts'
import {
  atEventLimit,
  LOG_MAX_BYTES,
  openLogFile,
  readLogContent,
  validEvent,
  writeAll,
} from './log-file.mts'
import { sanitizeSessionId } from './session-id.mts'
import { boundedText, isWellFormedUnicode, normalizeAuditText } from './text.mts'
import type {
  FrictionEvent,
  FrictionLogOptions,
  FrictionLogReadResult,
  FrictionObservation,
} from './types.mts'

export const FRICTION_LOG_MAX_EVENTS = 500
const EVENT_FIELD_MAX_LENGTH = 1_000
export function requireDirectory(directory: string): string {
  if (typeof directory !== 'string') throw new Error('log directory must be a string')
  if (Buffer.byteLength(directory) > 4096)
    throw new Error('session-friction log directory path is too long')
  if (!isAbsolute(directory)) throw new Error('session-friction log directory must be absolute')
  return resolve(directory)
}
export function eventLimit(maxEvents: number | undefined): number {
  const limit = maxEvents ?? FRICTION_LOG_MAX_EVENTS
  if (!Number.isInteger(limit) || limit < 1) throw new Error('maxEvents must be a positive integer')
  return Math.min(limit, FRICTION_LOG_MAX_EVENTS)
}
function logPath(sessionId: string, directory: string): string {
  return join(requireDirectory(directory), `${sanitizeSessionId(sessionId)}.jsonl`)
}
export function recordFriction(
  sessionId: string,
  observation: FrictionObservation,
  options: FrictionLogOptions & { timestamp?: string | (() => string) },
): void {
  const maxEvents = eventLimit(options.maxEvents)
  const timestamp: unknown =
    typeof options.timestamp === 'function' ? options.timestamp() : options.timestamp
  if (timestamp !== undefined && typeof timestamp !== 'string')
    throw new Error('timestamp must be a string')
  const rawTimestamp = timestamp ?? new Date().toISOString()
  const normalizedTimestamp = normalizeAuditText(boundedText(rawTimestamp, EVENT_FIELD_MAX_LENGTH))
  if (!normalizedTimestamp) throw new Error('timestamp must be non-empty')
  if (!isWellFormedUnicode(normalizedTimestamp))
    throw new Error('timestamp must be well-formed Unicode')
  const classified = classifyFrictionObservation(observation)
  const path = logPath(sessionId, options.directory)
  const directory = requireDirectory(options.directory)
  ensurePrivateDirectory(directory, true)
  withFileLock(path, () => {
    /* v8 ignore next 2 -- requires the directory path to be replaced after its lock is acquired. */
    if (!ensurePrivateDirectory(directory, false))
      throw new Error('session-friction log directory disappeared while acquiring the lock')
    const descriptor = openLogFile(path, constants.O_CREAT | constants.O_RDWR | constants.O_APPEND)
    try {
      fchmodSync(descriptor, 0o600)
      if (fstatSync(descriptor).size > LOG_MAX_BYTES)
        throw new Error('session-friction log is too large')
      if (!classified) return
      const content = readLogContent(descriptor)
      if (atEventLimit(content, maxEvents)) return
      const event = {
        ...classified,
        commandPrefix: normalizeAuditText(classified.commandPrefix),
        detail: normalizeAuditText(classified.detail),
        timestamp: normalizedTimestamp,
      }
      /* v8 ignore next -- normalized classified fields satisfy validEvent defensively. */
      if (!validEvent(event)) return
      const prefix = content && !content.endsWith('\n') ? '\n' : ''
      const addition = `${prefix}${JSON.stringify(event)}\n`
      if (fstatSync(descriptor).size + Buffer.byteLength(addition) > LOG_MAX_BYTES)
        throw new Error('session-friction log is too large')
      writeAll(descriptor, addition)
    } finally {
      closeSync(descriptor)
    }
  })
}

export function readFrictionLog(
  sessionId: string,
  options: FrictionLogOptions,
): FrictionLogReadResult {
  const maxEvents = eventLimit(options.maxEvents)
  const path = logPath(sessionId, options.directory)
  const directory = requireDirectory(options.directory)
  if (!ensurePrivateDirectory(directory, false)) return { status: 'absent' }
  try {
    return withFileLock(path, () => {
      /* v8 ignore next -- detects directory removal after acquiring the file lock. */
      if (!ensurePrivateDirectory(directory, false)) return { status: 'absent' }
      const descriptor = openLogFile(path, constants.O_RDONLY)
      try {
        const events: FrictionEvent[] = []
        for (const line of readLogContent(descriptor).split('\n')) {
          if (!line.trim()) continue
          try {
            const value: unknown = JSON.parse(line)
            if (validEvent(value)) events.push(value)
          } catch {}
          if (events.length >= maxEvents) break
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
