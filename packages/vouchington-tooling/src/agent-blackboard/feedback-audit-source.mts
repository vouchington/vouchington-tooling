import {
  buildSessionFrictionReport,
  type SessionFrictionReport,
  type SessionFrictionReportOptions,
} from '../session-friction/index.mts'
import {
  buildJournalAuditReport,
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

/** Builds the CI-failure and sandbox sections from the friction log or from journal entries alone. */
export async function buildAuditReport(
  sessionId: string,
  input: AuditSourceInput,
): Promise<AuditReport> {
  if (input.friction) return buildSessionFrictionReport(sessionId, input.friction)
  if (input.journal) return buildJournalAuditReport(sessionId, input.journal)
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
