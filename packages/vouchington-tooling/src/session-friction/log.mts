import { appendFileSync, chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
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

function readLogContent(path: string): string {
  if (statSync(path).size > LOG_MAX_BYTES) throw new Error('session-friction log is too large')
  const buffer = readFileSync(path)
  /* v8 ignore next -- detects external growth between the size check and read. */
  if (buffer.length > LOG_MAX_BYTES) throw new Error('session-friction log is too large')
  return buffer.toString('utf8')
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
    appendFileSync(path, '', { encoding: 'utf8', mode: 0o600 })
    chmodSync(path, 0o600)
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
  if (!ensurePrivateDirectory(requireDirectory(options.directory), false))
    return { status: 'absent' }
  try {
    return withFileLock(path, () => {
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
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return { status: 'absent' }
    throw error
  }
}
