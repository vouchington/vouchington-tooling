import type { SnapshotCounts, SnapshotManifest } from './snapshot-types.mts'
import { assertSessionId } from './session-id.mts'

export type SnapshotBlock = {
  sessionId: string
  path: string
  bytes: number
  sessions: number
  entries: number
}
export type SnapshotRecord =
  | { type: 'session'; session: Record<string, unknown> }
  | { type: 'entry'; entry: Record<string, unknown> }
  | { type: 'manifest'; manifest: SnapshotManifest }
export type SnapshotState = {
  sessions: number
  entries: number
  records: number
  lastSessionCreatedAt?: number
  lastEntryCreatedAt?: number
  currentSessionId?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function isSelection(value: unknown): boolean {
  if (!isObject(value) || value.archived !== false) return false
  if (value.agent !== undefined && typeof value.agent !== 'string') return false
  if (value.version !== undefined && typeof value.version !== 'string') return false
  if (
    value.parentSessionId !== undefined &&
    value.parentSessionId !== null &&
    typeof value.parentSessionId !== 'string'
  )
    return false
  if (value.data !== undefined && !isObject(value.data)) return false
  return (
    value.inactiveForHours === undefined ||
    (typeof value.inactiveForHours === 'number' &&
      Number.isFinite(value.inactiveForHours) &&
      value.inactiveForHours > 0)
  )
}
function isManifest(value: unknown): value is SnapshotManifest {
  if (!isObject(value) || value.schemaVersion !== 1 || value.status !== 'complete') return false
  if (
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.completedAt) ||
    !isSelection(value.selection)
  )
    return false
  if (
    !isObject(value.counts) ||
    !isCount(value.counts.sessions) ||
    !isCount(value.counts.entries) ||
    !isCount(value.counts.records)
  )
    return false
  return (
    isObject(value.ordering) &&
    value.ordering.sessions === 'createdAt ascending' &&
    value.ordering.entries === 'createdAt ascending within session' &&
    value.consistency === 'best-effort'
  )
}
function isSession(value: unknown): value is Record<string, unknown> {
  if (
    isObject(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    (value.parentSessionId === null || typeof value.parentSessionId === 'string') &&
    typeof value.agent === 'string' &&
    typeof value.version === 'string' &&
    isTimestamp(value.createdAt) &&
    (value.lastEntryAt === null || isTimestamp(value.lastEntryAt)) &&
    value.archivedAt === null &&
    isObject(value.data)
  ) {
    try {
      assertSessionId(value.id)
      if (value.parentSessionId !== null)
        assertSessionId(value.parentSessionId, 'parent session id')
      return true
    } catch {
      return false
    }
  }
  return false
}
function isEntry(value: unknown): value is Record<string, unknown> {
  if (
    isObject(value) &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    isTimestamp(value.createdAt) &&
    isObject(value.data)
  ) {
    try {
      assertSessionId(value.sessionId)
      return true
    } catch {
      return false
    }
  }
  return false
}
export function snapshotLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}
export function countsFor(
  block: Pick<SnapshotBlock, 'sessions' | 'entries'>,
  bytes: number,
): SnapshotCounts {
  return {
    sessions: block.sessions,
    entries: block.entries,
    records: block.sessions + block.entries + 1,
    bytes,
  }
}
export function manifestFor(
  manifest: SnapshotManifest,
  block: Pick<SnapshotBlock, 'sessions' | 'entries'>,
): SnapshotManifest {
  const counts = countsFor(block, 0)
  return {
    ...manifest,
    counts: { sessions: counts.sessions, entries: counts.entries, records: counts.records },
  }
}
export function parseSnapshotRecord(line: string): SnapshotRecord {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error('snapshot contains invalid JSONL')
  }
  if (!isObject(value)) throw new Error('snapshot contains an invalid record')
  if (value.type === 'session' && isSession(value.session))
    return { type: 'session', session: value.session }
  if (value.type === 'entry' && isEntry(value.entry)) return { type: 'entry', entry: value.entry }
  if (value.type === 'manifest' && isObject(value.manifest))
    return { type: 'manifest', manifest: value.manifest as SnapshotManifest }
  throw new Error('snapshot contains an unsupported record')
}
export function consumeSnapshotRecord(record: SnapshotRecord, state: SnapshotState): void {
  if (record.type === 'manifest') return
  if (record.type === 'session') {
    const createdAt = Date.parse(record.session.createdAt as string)
    if (state.lastSessionCreatedAt && createdAt < state.lastSessionCreatedAt)
      throw new Error('snapshot sessions are not ordered')
    state.sessions += 1
    state.records += 1
    state.lastSessionCreatedAt = createdAt
    delete state.lastEntryCreatedAt
    state.currentSessionId = record.session.id as string
    return
  }
  const createdAt = Date.parse(record.entry.createdAt as string)
  if (state.currentSessionId !== record.entry.sessionId)
    throw new Error('snapshot entries must follow their session')
  if (state.lastEntryCreatedAt && createdAt < state.lastEntryCreatedAt)
    throw new Error('snapshot entries are not ordered')
  state.entries += 1
  state.records += 1
  state.lastEntryCreatedAt = createdAt
}
export function assertManifest(manifest: SnapshotManifest, state: SnapshotState): void {
  if (!isManifest(manifest)) throw new Error('snapshot is missing a complete terminal manifest')
  if (
    manifest.counts.sessions !== state.sessions ||
    manifest.counts.entries !== state.entries ||
    manifest.counts.records !== state.records + 1
  )
    throw new Error('snapshot manifest counts do not match its records')
}
