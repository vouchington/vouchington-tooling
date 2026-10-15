import {
  buildCiFailuresSection,
  getConformingGroups,
  incompleteCiSection,
} from '../audit-journal/ci-failures.mts'
import { scanJournal, type JournalScan } from '../audit-journal/journal.mts'
import { validateSessionId } from '../audit-journal/session-id.mts'
import type { AuditCoverage, JournalLoader } from '../audit-journal/types.mts'
import {
  getConformingSandboxBlocks,
  journalSandboxSection,
  unavailableSandboxSection,
} from './feedback-journal-sandbox.mts'

export type JournalAuditOptions = {
  journalLoader: JournalLoader
  /** Redacts raw field text before Markdown escaping, which would otherwise break matching. */
  redact?: (value: string) => string
  /** Byte allowances for the CI and sandbox sections, as maximums over the built-in budgets. */
  budgets?: { ciBytes: number; sandboxBytes: number }
}

/** `journal-only` says both sections were assessed from journal entries, with no log observed. */
export type JournalAuditReport = {
  coverage: {
    journalStatus: AuditCoverage['journalStatus']
    truncated: false
  }
  markdown: string
}

function report(
  journalStatus: JournalAuditReport['coverage']['journalStatus'],
  markdown: string,
): JournalAuditReport {
  return { coverage: { journalStatus, truncated: false }, markdown }
}

function unavailable(reason: string): JournalAuditReport {
  return report(
    'unavailable',
    `## CI Failures\nStatus: unavailable (${reason})\n\n${unavailableSandboxSection(reason)}`,
  )
}

/**
 * Builds `## CI Failures` and `## Sandbox & Permission Audit` from the session's journal entries
 * alone. A session with no journal is unavailable rather than empty: nothing else establishes
 * that the session was observed.
 */
export async function loadJournalAuditInput(
  sessionId: string,
  options: JournalAuditOptions,
): Promise<JournalScan> {
  validateSessionId(sessionId)
  return scanJournal(sessionId, options.journalLoader)
}

/** Pure render of a loaded journal scan, so it can be repeated without reloading. */
export function renderJournalAuditReport(
  options: JournalAuditOptions,
  scanned: JournalScan,
): JournalAuditReport {
  if (scanned.status === 'unreachable') return unavailable('blackboard unreachable')
  if (scanned.status === 'not-found') return unavailable('no journal for session')
  const ci = getConformingGroups(scanned.entries, options.redact, options.budgets?.ciBytes)
  const sandbox = getConformingSandboxBlocks(
    scanned.entries,
    options.redact,
    options.budgets?.sandboxBytes,
  )
  if (scanned.truncated)
    return report(
      'partial',
      `${incompleteCiSection(ci)}\n\n${unavailableSandboxSection('journal scan incomplete', sandbox)}`,
    )
  return report('complete', `${buildCiFailuresSection(ci)}\n\n${journalSandboxSection(sandbox)}`)
}

export async function buildJournalAuditReport(
  sessionId: string,
  options: JournalAuditOptions,
): Promise<JournalAuditReport> {
  return renderJournalAuditReport(options, await loadJournalAuditInput(sessionId, options))
}
