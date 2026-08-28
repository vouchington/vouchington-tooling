import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { classifyFrictionObservation } from './classify.mts'
import type {
  FrictionEvent,
  FrictionLogOptions,
  FrictionLogReadResult,
  FrictionObservation,
} from './types.mts'

export const FRICTION_LOG_MAX_EVENTS = 500

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
  return sessionId.replace(/[^A-Za-z0-9_.-]/g, '_')
}

function logPath(sessionId: string, directory: string): string {
  return join(requireDirectory(directory), `${sanitizeSessionId(sessionId)}.jsonl`)
}

function ensureLog(sessionId: string, directory: string): string {
  const path = logPath(sessionId, directory)
  mkdirSync(requireDirectory(directory), { recursive: true })
  if (!existsSync(path)) writeFileSync(path, '', 'utf8')
  return path
}

function validEvent(value: unknown): value is FrictionEvent {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    (record.kind === 'sandbox-escalation' || record.kind === 'sandbox-failure') &&
    typeof record.timestamp === 'string' &&
    typeof record.commandPrefix === 'string' &&
    typeof record.detail === 'string'
  )
}

export function recordFriction(
  sessionId: string,
  observation: FrictionObservation,
  options: FrictionLogOptions & { timestamp?: string | (() => string) },
): void {
  const maxEvents = eventLimit(options.maxEvents)
  const path = ensureLog(sessionId, options.directory)
  const count = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim()).length
  if (count >= maxEvents) return
  const classified = classifyFrictionObservation(observation)
  if (!classified) return
  const timestamp =
    typeof options.timestamp === 'function' ? options.timestamp() : options.timestamp
  appendFileSync(
    path,
    `${JSON.stringify({ ...classified, timestamp: timestamp ?? new Date().toISOString() })}\n`,
    'utf8',
  )
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
