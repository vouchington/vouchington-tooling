import { readFrictionLog } from './log.mts'
import { buildCiFailuresSection, getConformingGroups } from './ci-failures.mts'
import { buildSandboxSection } from './sandbox.mts'
import type {
  FrictionLogOptions,
  JournalEntry,
  JournalLoadResult,
  SessionFrictionReport,
  SessionFrictionReportOptions,
} from './types.mts'

async function collectEntries(
  entries: Iterable<JournalEntry> | AsyncIterable<JournalEntry>,
): Promise<JournalEntry[]> {
  const result: JournalEntry[] = []
  for await (const entry of entries) result.push(entry)
  return result
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unprintable error]'
  }
}

function reportFromLog(
  sessionId: string,
  logOptions: FrictionLogOptions,
  journal:
    | { status: 'ok'; markdownBlocks: string[] }
    | { status: 'unreachable'; diagnostic: string },
): SessionFrictionReport {
  const friction = readFrictionLog(sessionId, logOptions)
  const markdown = buildCiFailuresSection(sessionId, journal, friction.status)
  if (friction.status !== 'events') return { markdown }
  return { markdown: `${markdown}\n\n${buildSandboxSection(friction.events)}` }
}

export async function buildSessionFrictionReport(
  sessionId: string,
  options: SessionFrictionReportOptions,
): Promise<SessionFrictionReport> {
  let journal:
    | { status: 'ok'; markdownBlocks: string[] }
    | { status: 'unreachable'; diagnostic: string }
  try {
    const loaded: JournalLoadResult = await options.journalLoader(sessionId)
    if (loaded.status === 'not-found') journal = { status: 'ok', markdownBlocks: [] }
    else
      journal = {
        status: 'ok',
        markdownBlocks: getConformingGroups(await collectEntries(loaded.entries)),
      }
  } catch (error) {
    const diagnostic = errorMessage(error)
    journal = { status: 'unreachable', diagnostic }
  }
  const report = reportFromLog(sessionId, options, journal)
  return journal.status === 'unreachable' ? { ...report, diagnostic: journal.diagnostic } : report
}
