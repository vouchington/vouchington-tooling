import { eventLimit, readFrictionLog, requireDirectory } from './log.mts'
import { buildCiFailuresSection, getConformingGroups, incompleteCiSection } from './ci-failures.mts'
import { errorMessage, scanJournal, type JournalScan } from './journal.mts'
import { buildSandboxSection } from './sandbox.mts'
import { validateSessionId } from './session-id.mts'
import type {
  FrictionLogReadResult,
  SessionFrictionReport,
  SessionFrictionReportOptions,
} from './types.mts'

type FrictionRead = { result: FrictionLogReadResult } | { error: unknown }
/** Everything a report reads from outside, loaded once so rendering can be repeated for free. */
export type FrictionReportInputs = { scanned: JournalScan; read: FrictionRead }

type ReportJournal =
  | { status: 'ok'; markdownBlocks: string[]; truncated: boolean }
  | { status: 'unreachable'; diagnostic: string }

function sandboxMarkdown(
  friction: FrictionLogReadResult,
  options: SessionFrictionReportOptions,
): string {
  if (friction.status === 'events')
    return `${friction.truncated ? `## Capture Coverage\nStatus: partial\nDropped records: ${friction.droppedCount}\n\n` : ''}${buildSandboxSection(friction.events, options.redact, options.budgets?.sandboxBytes)}`
  if (friction.status === 'empty' && friction.truncated)
    return `## Sandbox & Permission Audit\nStatus: unavailable (partial capture; dropped ${friction.droppedCount} records)`
  const status = friction.status === 'empty' ? 'none observed' : 'unavailable (no friction log)'
  return `## Sandbox & Permission Audit\nStatus: ${status}`
}

function reportFromLog(
  sessionId: string,
  logOptions: SessionFrictionReportOptions,
  journal: ReportJournal,
  read: FrictionRead,
): SessionFrictionReport {
  if ('result' in read) {
    const friction = read.result
    const coverage = {
      journalStatus:
        journal.status === 'unreachable'
          ? ('unavailable' as const)
          : journal.truncated
            ? ('partial' as const)
            : ('complete' as const),
      frictionStatus: friction.status,
      truncated: friction.status !== 'absent' && friction.truncated === true,
      ...(friction.status === 'absent' ? {} : { droppedCount: friction.droppedCount ?? 0 }),
    }
    if (journal.status === 'ok' && journal.truncated)
      return {
        coverage,
        markdown:
          incompleteCiSection(journal.markdownBlocks) +
          '\n\n' +
          sandboxMarkdown(friction, logOptions),
      }
    const markdown = buildCiFailuresSection(sessionId, journal, friction.status)
    return { coverage, markdown: `${markdown}\n\n${sandboxMarkdown(friction, logOptions)}` }
  } else {
    const ciMarkdown =
      journal.status === 'ok' && journal.truncated
        ? incompleteCiSection(journal.markdownBlocks)
        : journal.status === 'ok' && journal.markdownBlocks.length === 0
          ? '## CI Failures\nStatus: unavailable (friction log unreadable)'
          : buildCiFailuresSection(sessionId, journal, 'empty')
    return {
      coverage: {
        journalStatus:
          journal.status === 'unreachable'
            ? 'unavailable'
            : journal.truncated
              ? 'partial'
              : 'complete',
        frictionStatus: 'unreadable',
        truncated: true,
      },
      markdown: `${ciMarkdown}\n\n## Sandbox & Permission Audit\nStatus: unavailable (friction log unreadable)`,
      diagnostic: errorMessage(read.error),
    }
  }
}

export async function loadFrictionReportInputs(
  sessionId: string,
  options: SessionFrictionReportOptions,
): Promise<FrictionReportInputs> {
  validateSessionId(sessionId)
  requireDirectory(options.directory)
  eventLimit(options.maxEvents)
  const scanned = await scanJournal(sessionId, options.journalLoader)
  try {
    return { scanned, read: { result: readFrictionLog(sessionId, options) } }
  } catch (error) {
    return { scanned, read: { error } }
  }
}

export function renderFrictionReport(
  sessionId: string,
  options: SessionFrictionReportOptions,
  { scanned, read }: FrictionReportInputs,
): SessionFrictionReport {
  const journal: ReportJournal =
    scanned.status === 'unreachable'
      ? scanned
      : scanned.status === 'not-found'
        ? { status: 'ok', markdownBlocks: [], truncated: false }
        : {
            status: 'ok',
            markdownBlocks: getConformingGroups(
              scanned.entries,
              options.redact,
              options.budgets?.ciBytes,
            ),
            truncated: scanned.truncated,
          }
  const report = reportFromLog(sessionId, options, journal, read)
  if (journal.status === 'unreachable') {
    const diagnostic = report.diagnostic
      ? `${journal.diagnostic}; ${report.diagnostic}`
      : journal.diagnostic
    return { ...report, diagnostic }
  }
  return report
}

export async function buildSessionFrictionReport(
  sessionId: string,
  options: SessionFrictionReportOptions,
): Promise<SessionFrictionReport> {
  return renderFrictionReport(
    sessionId,
    options,
    await loadFrictionReportInputs(sessionId, options),
  )
}
