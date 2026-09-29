import {
  buildCiFailuresSection,
  getConformingGroups,
  incompleteCiSection,
} from '../session-friction/ci-failures.mts'
import { scanJournal } from '../session-friction/journal.mts'
import { validateSessionId } from '../session-friction/session-id.mts'
import type { JournalLoader, SessionFrictionCoverage } from '../session-friction/types.mts'
import {
  getConformingSandboxBlocks,
  journalSandboxSection,
  unavailableSandboxSection,
} from './feedback-journal-sandbox.mts'

export type JournalAuditOptions = { journalLoader: JournalLoader }

/** `journal-only` says both sections were assessed from journal entries, with no log observed. */
export type JournalAuditReport = {
  coverage: {
    journalStatus: SessionFrictionCoverage['journalStatus']
    frictionStatus: 'journal-only'
    truncated: false
    droppedCount?: never
  }
  markdown: string
}

function report(
  journalStatus: JournalAuditReport['coverage']['journalStatus'],
  markdown: string,
): JournalAuditReport {
  return { coverage: { journalStatus, frictionStatus: 'journal-only', truncated: false }, markdown }
}

function unavailable(reason: string): JournalAuditReport {
  return report(
    'unavailable',
    `## CI Failures\nStatus: unavailable (${reason})\n\n${unavailableSandboxSection(reason)}`,
  )
}

/**
 * Builds `## CI Failures` and `## Sandbox & Permission Audit` from the session's journal entries
 * alone. Unlike `buildSessionFrictionReport`, a session with no journal is unavailable rather than
 * empty: without a log, nothing else establishes that the session was observed.
 */
export async function buildJournalAuditReport(
  sessionId: string,
  options: JournalAuditOptions,
): Promise<JournalAuditReport> {
  validateSessionId(sessionId)
  const scanned = await scanJournal(sessionId, options.journalLoader)
  if (scanned.status === 'unreachable') return unavailable('blackboard unreachable')
  if (scanned.status === 'not-found') return unavailable('no journal for session')
  const ci = getConformingGroups(scanned.entries)
  const sandbox = getConformingSandboxBlocks(scanned.entries)
  if (scanned.truncated)
    return report(
      'partial',
      `${incompleteCiSection(ci)}\n\n${unavailableSandboxSection('journal scan incomplete', sandbox)}`,
    )
  const journal = { status: 'ok' as const, markdownBlocks: ci, truncated: false }
  return report(
    'complete',
    `${buildCiFailuresSection(sessionId, journal, 'journal-only')}\n\n${journalSandboxSection(sandbox)}`,
  )
}
