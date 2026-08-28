import { readFrictionLog } from './log.mts'
import { buildCiFailuresSection, getConformingGroups } from './ci-failures.mts'
import { buildSandboxSection } from './sandbox.mts'
import { validateSessionId } from './session-id.mts'
import type {
  FrictionLogOptions,
  FrictionLogReadResult,
  JournalEntry,
  JournalLoadResult,
  SessionFrictionReport,
  SessionFrictionReportOptions,
} from './types.mts'

const JOURNAL_ENTRY_MAX_COUNT = 500
const JOURNAL_MARKDOWN_MAX_BYTES = 10_000
const JOURNAL_TOTAL_MAX_BYTES = 1_000_000

async function collectEntries(
  entries: Iterable<JournalEntry> | AsyncIterable<JournalEntry>,
): Promise<{ entries: JournalEntry[]; truncated: boolean }> {
  const result: JournalEntry[] = []
  let consumed = 0
  let inspectedBytes = 0
  let retainedBytes = 0
  let truncated = false
  for await (const entry of entries) {
    consumed++
    const data = (entry as JournalEntry | null)?.data
    const markdown = data?.markdown
    if (data?.type === 'journal' && typeof markdown === 'string') {
      const bytes = Buffer.byteLength(markdown)
      inspectedBytes += bytes
      if (bytes > JOURNAL_MARKDOWN_MAX_BYTES) truncated = true
      if (bytes <= JOURNAL_MARKDOWN_MAX_BYTES && retainedBytes + bytes <= JOURNAL_TOTAL_MAX_BYTES) {
        result.push({ data: { type: 'journal', markdown } })
        retainedBytes += bytes
      }
    }
    if (
      consumed >= JOURNAL_ENTRY_MAX_COUNT ||
      inspectedBytes >= JOURNAL_TOTAL_MAX_BYTES ||
      retainedBytes >= JOURNAL_TOTAL_MAX_BYTES
    ) {
      truncated = true
      break
    }
  }
  return { entries: result, truncated }
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unprintable error]'
  }
}

function sandboxMarkdown(friction: FrictionLogReadResult): string {
  if (friction.status === 'events') return buildSandboxSection(friction.events)
  const status = friction.status === 'empty' ? 'none observed' : 'unavailable (no friction log)'
  return `## Sandbox & Permission Audit\nStatus: ${status}`
}

function reportFromLog(
  sessionId: string,
  logOptions: FrictionLogOptions,
  journal:
    | { status: 'ok'; markdownBlocks: string[]; truncated: boolean }
    | { status: 'unreachable'; diagnostic: string },
): SessionFrictionReport {
  try {
    const friction = readFrictionLog(sessionId, logOptions)
    const markdown = buildCiFailuresSection(sessionId, journal, friction.status)
    return { markdown: `${markdown}\n\n${sandboxMarkdown(friction)}` }
  } catch (error) {
    const ciMarkdown =
      journal.status === 'ok' && journal.markdownBlocks.length === 0
        ? '## CI Failures\nStatus: unavailable (friction log unreadable)'
        : buildCiFailuresSection(sessionId, journal, 'empty')
    return {
      markdown: `${ciMarkdown}\n\n## Sandbox & Permission Audit\nStatus: unavailable (friction log unreadable)`,
      diagnostic: errorMessage(error),
    }
  }
}

export async function buildSessionFrictionReport(
  sessionId: string,
  options: SessionFrictionReportOptions,
): Promise<SessionFrictionReport> {
  validateSessionId(sessionId)
  let journal:
    | { status: 'ok'; markdownBlocks: string[]; truncated: boolean }
    | { status: 'unreachable'; diagnostic: string }
  try {
    const loaded: JournalLoadResult = await options.journalLoader(sessionId)
    if (loaded.status === 'not-found')
      journal = { status: 'ok', markdownBlocks: [], truncated: false }
    else {
      const collected = await collectEntries(loaded.entries)
      journal = {
        status: 'ok',
        markdownBlocks: getConformingGroups(collected.entries),
        truncated: collected.truncated,
      }
    }
  } catch (error) {
    const diagnostic = errorMessage(error)
    journal = { status: 'unreachable', diagnostic }
  }
  const report = reportFromLog(sessionId, options, journal)
  if (journal.status === 'unreachable') {
    const diagnostic = report.diagnostic
      ? `${journal.diagnostic}; ${report.diagnostic}`
      : journal.diagnostic
    return { ...report, diagnostic }
  }
  return report
}
