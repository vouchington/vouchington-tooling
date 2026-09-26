import type { SnapshotManifest } from './snapshot-types.mts'
import { assertSessionId } from './session-id.mts'
import { isCount, isObject, isTimestamp } from './snapshot-partition-guards.mts'

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
  if (
    value.dataArrayContains !== undefined &&
    (!isObject(value.dataArrayContains) ||
      Object.keys(value.dataArrayContains).length === 0 ||
      Object.entries(value.dataArrayContains).some(
        ([key, member]) => key.length === 0 || typeof member !== 'string' || member.length === 0,
      ))
  )
    return false
  return (
    value.inactiveForHours === undefined ||
    (typeof value.inactiveForHours === 'number' &&
      Number.isFinite(value.inactiveForHours) &&
      value.inactiveForHours > 0)
  )
}

export function isManifest(value: unknown): value is SnapshotManifest {
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

export function isSession(value: unknown): value is Record<string, unknown> {
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
