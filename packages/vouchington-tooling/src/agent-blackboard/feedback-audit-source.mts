import {
  loadFrictionReportInputs,
  renderFrictionReport,
  type FrictionReportInputs,
  type SessionFrictionReport,
  type SessionFrictionReportOptions,
} from '../session-friction/index.mts'
import type { JournalScan } from '../session-friction/journal.mts'
import {
  loadJournalAuditInput,
  renderJournalAuditReport,
  type JournalAuditOptions,
  type JournalAuditReport,
} from './feedback-journal-audit.mts'

export type AuditSourceInput = {
  friction?: SessionFrictionReportOptions
  journal?: JournalAuditOptions
}
export type AuditReport = SessionFrictionReport | JournalAuditReport

const ASSESSED_SOURCE_ERROR =
  'complete feedback coverage requires assessed available factual and finding sources'
const NOT_ASSESSED_MARKDOWN =
  '## CI Failures\nStatus: unavailable (not assessed)\n\n## Sandbox & Permission Audit\nStatus: unavailable (not assessed)'

export function assertSingleAuditSource(input: AuditSourceInput): void {
  if (input.friction && input.journal)
    throw new Error('composition accepts either a friction or a journal audit source, not both')
}

/** What the audit sections read from outside, loaded once and rendered as often as needed. */
export type AuditInputs =
  | { kind: 'friction'; loaded: FrictionReportInputs }
  | { kind: 'journal'; scanned: JournalScan }
  | { kind: 'none' }

export async function loadAuditInputs(
  sessionId: string,
  input: AuditSourceInput,
): Promise<AuditInputs> {
  if (input.friction)
    return { kind: 'friction', loaded: await loadFrictionReportInputs(sessionId, input.friction) }
  if (input.journal)
    return { kind: 'journal', scanned: await loadJournalAuditInput(sessionId, input.journal) }
  return { kind: 'none' }
}

/** Builds the CI-failure and sandbox sections from loaded inputs, with no further I/O. */
export function renderAuditReport(
  sessionId: string,
  input: AuditSourceInput,
  inputs: AuditInputs,
): AuditReport {
  if (inputs.kind === 'friction')
    return renderFrictionReport(sessionId, input.friction!, inputs.loaded)
  if (inputs.kind === 'journal')
    return renderJournalAuditReport(sessionId, input.journal!, inputs.scanned)
  return {
    coverage: { journalStatus: 'unavailable', frictionStatus: 'absent', truncated: false },
    markdown: NOT_ASSESSED_MARKDOWN,
  }
}

/** Only a real log status or an explicit journal-only scan counts as assessed. */
export function auditAssessed({ coverage }: AuditReport): boolean {
  return (
    coverage.journalStatus === 'complete' &&
    ['empty', 'events', 'journal-only'].includes(coverage.frictionStatus) &&
    !coverage.truncated
  )
}

export function completeCoverageError(input: AuditSourceInput): Error {
  return new Error(
    input.friction || input.journal
      ? ASSESSED_SOURCE_ERROR
      : `${ASSESSED_SOURCE_ERROR} (no friction or journal source supplied for CI failures and sandbox audit)`,
  )
}
