import { isDeepStrictEqual } from 'node:util'
import type { Session, SessionEntry } from './session-types.mts'

import { validateFeedbackEnvelope } from '../agent-blackboard/index.mts'
import { isCheckpointEntry } from './checkpoint-entry.mts'
import { isRetrospectiveEntry } from './retrospective-entry.mts'

/**
 * Session shape taxonomy and distillation eligibility.
 *
 * This code is the source of truth for both. The retrospective-distill skill is the canonical
 * human-facing description; when an inspector's hand classification and this output disagree on
 * the same session, fix the skill to match this code, not the other way around.
 *
 * `zero-entry-child` / `zero-entry-root` name a session-topology fact (whether `parentSessionId`
 * is set), not a completion signal: a delegated child that dies mid-task is a zero-entry-child
 * session too, indistinguishable here from one that finished its bounded assignment cleanly.
 * Docs referencing this split must not imply "child" means "completed normally".
 */
export type SessionShape =
  | 'retrospective'
  | 'entry-type-unresolved'
  | 'checkpoint-only'
  | 'journal-only'
  | 'zero-entry-child'
  | 'zero-entry-root'

export type SessionClassification = {
  sessionId: string
  shape: SessionShape
  eligible: boolean
  quarantine?: { entryCount: number; reasons: string[] }
  duplicateEntryCount?: number
}

export type DistillCutoffs = {
  retroCutoff: string
  sessionCutoff: string
}

function quarantineReason(entry: SessionEntry): string | undefined {
  if (entry.data.type !== 'journal' && entry.data.type !== 'retrospective')
    return 'unknown-entry-type'
  if (entry.data.schemaVersion !== undefined) {
    try {
      validateFeedbackEnvelope(entry.data)
    } catch {
      return 'invalid-feedback-envelope'
    }
  }
  return undefined
}

function hasUnresolvedType(entry: SessionEntry): boolean {
  return quarantineReason(entry) !== undefined
}

function classifyShape(session: Session, entries: SessionEntry[]): SessionShape {
  if (entries.some(hasUnresolvedType)) return 'entry-type-unresolved'
  if (entries.some(isRetrospectiveEntry)) return 'retrospective'
  if (entries.length === 0) {
    // Loose equality on purpose: a partition record missing `parentSessionId` entirely (the reader
    // trusts the file on disk and does not re-validate every field against the Session interface —
    // see partition-records.mts) must fall to zero-entry-root. This is a topology and capture-gap
    // signal, never evidence of crash or clean completion. `=== null` would silently misroute
    // `undefined` into the wrong, discarded bucket.
    return session.parentSessionId == null ? 'zero-entry-root' : 'zero-entry-child'
  }
  return entries.every(isCheckpointEntry) ? 'checkpoint-only' : 'journal-only'
}

function newestRetrospectiveAt(entries: SessionEntry[]): string | undefined {
  let newest: string | undefined
  for (const entry of entries) {
    if (!isRetrospectiveEntry(entry)) continue
    if (newest === undefined || Date.parse(entry.createdAt) > Date.parse(newest))
      newest = entry.createdAt
  }
  return newest
}

// Eligibility rule:
// (has a retrospective entry AND retroAt < retroCutoff) OR (lastActive < sessionCutoff).
// An entry-type-unresolved session gets no issue-filing or archival pass "this run, regardless of
// its age", so it is never eligible — that check short-circuits before the formula.
function isEligible(
  session: Session,
  entries: SessionEntry[],
  shape: SessionShape,
  cutoffs: DistillCutoffs,
): boolean {
  if (shape === 'entry-type-unresolved') return false
  const retroAt = newestRetrospectiveAt(entries)
  const staleRetro = retroAt !== undefined && Date.parse(retroAt) < Date.parse(cutoffs.retroCutoff)
  const lastActive = entries.reduce(
    (latest, entry) =>
      Date.parse(entry.createdAt) > Date.parse(latest) ? entry.createdAt : latest,
    session.createdAt,
  )
  const staleSession = Date.parse(lastActive) < Date.parse(cutoffs.sessionCutoff)
  return staleRetro || staleSession
}

// An event is its session, `sourceEventId`, and content; the server assigns `timestamp` per attempt
// (a retry or a late write beside it can store the same event twice), so it is not identity.
function withoutTimestamp(data: SessionEntry['data']) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'timestamp'))
}

function normalizeSourceEvents(entries: SessionEntry[]) {
  const events = new Map<string, SessionEntry>()
  const unique: SessionEntry[] = []
  let duplicateEntryCount = 0
  let conflictCount = 0
  for (const entry of entries) {
    if (entry.data.schemaVersion !== 1 || quarantineReason(entry) !== undefined) {
      unique.push(entry)
      continue
    }
    const key = `${entry.sessionId}:${String(entry.data.sourceEventId)}`
    const existing = events.get(key)
    if (!existing) {
      events.set(key, entry)
      unique.push(entry)
      continue
    }
    if (!isDeepStrictEqual(withoutTimestamp(existing.data), withoutTimestamp(entry.data))) {
      conflictCount++
      continue
    }
    duplicateEntryCount++
    // At-least-once replay does not postpone a source event's distillation age.
    if (Date.parse(entry.createdAt) < Date.parse(existing.createdAt)) {
      unique[unique.indexOf(existing)] = entry
      events.set(key, entry)
    }
  }
  return { unique, duplicateEntryCount, conflictCount }
}

export function classifySession(
  session: Session,
  entries: SessionEntry[],
  cutoffs: DistillCutoffs,
): SessionClassification {
  const { unique, duplicateEntryCount, conflictCount } = normalizeSourceEvents(entries)
  const shape = conflictCount ? 'entry-type-unresolved' : classifyShape(session, unique)
  const reasons = entries
    .map(quarantineReason)
    .filter((reason): reason is string => reason !== undefined)
  for (let index = 0; index < conflictCount; index++) reasons.push('conflicting-source-event')
  return {
    sessionId: session.id,
    shape,
    eligible: isEligible(session, unique, shape, cutoffs),
    ...(duplicateEntryCount ? { duplicateEntryCount } : {}),
    ...(reasons.length === 0
      ? {}
      : { quarantine: { entryCount: reasons.length, reasons: [...new Set(reasons)].toSorted() } }),
  }
}
