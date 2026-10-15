import type { JournalScan } from '../audit-journal/journal.mts'
import {
  loadJournalAuditInput,
  renderJournalAuditReport,
  type JournalAuditOptions,
  type JournalAuditReport,
} from './feedback-journal-audit.mts'

export type AuditSourceInput = {
  journal?: JournalAuditOptions
}
export type AuditReport = JournalAuditReport

const ASSESSED_SOURCE_ERROR =
  'complete feedback coverage requires assessed available factual and finding sources'
const NOT_ASSESSED_MARKDOWN =
  '## CI Failures\nStatus: unavailable (not assessed)\n\n## Sandbox & Permission Audit\nStatus: unavailable (not assessed)'

/** What the audit sections read from outside, loaded once and rendered as often as needed. */
export type AuditInputs = { kind: 'journal'; scanned: JournalScan } | { kind: 'none' }

export async function loadAuditInputs(
  sessionId: string,
  input: AuditSourceInput,
): Promise<AuditInputs> {
  if (input.journal)
    return { kind: 'journal', scanned: await loadJournalAuditInput(sessionId, input.journal) }
  return { kind: 'none' }
}

/** Builds the CI-failure and sandbox sections from loaded inputs, with no further I/O. */
export function renderAuditReport(input: AuditSourceInput, inputs: AuditInputs): AuditReport {
  if (inputs.kind === 'journal') return renderJournalAuditReport(input.journal!, inputs.scanned)
  return {
    coverage: { journalStatus: 'unavailable', truncated: false },
    markdown: NOT_ASSESSED_MARKDOWN,
  }
}

/** Only a complete, untruncated journal scan counts as assessed. */
export function auditAssessed({ coverage }: AuditReport): boolean {
  return coverage.journalStatus === 'complete' && !coverage.truncated
}

export function completeCoverageError(input: AuditSourceInput): Error {
  return new Error(
    input.journal
      ? ASSESSED_SOURCE_ERROR
      : `${ASSESSED_SOURCE_ERROR} (no journal source supplied for CI failures and sandbox audit)`,
  )
}
