import { parseDistillClassifyArgs } from './args.mts'
import { readPartitionRecords } from './partition-records.mts'
import { classifySession } from './shape.mts'

function formatLine(sessionId: string, shape: string, eligible: boolean): string {
  return `${sessionId}\t${shape}\t${eligible ? 'eligible' : 'not-yet-eligible'}`
}

/**
 * Pure local JSONL parsing plus classification — no network, blackboard client, or writes, so it
 * can run under a read-only inspector sandbox. Returns one tab-separated line per session.
 */
export async function runDistillClassify(argv: string[]): Promise<string> {
  const args = parseDistillClassifyArgs(argv)
  const { sessions, entriesBySession } = await readPartitionRecords(args.partitionPath)
  if (sessions.length === 0) return 'No sessions found in partition.'

  const cutoffs = { retroCutoff: args.retroCutoff, sessionCutoff: args.sessionCutoff }
  return sessions
    .map((session) => {
      const entries = entriesBySession.get(session.id) ?? []
      const { shape, eligible, quarantine, duplicateEntryCount } = classifySession(
        session,
        entries,
        cutoffs,
      )
      const line =
        formatLine(session.id, shape, eligible) +
        (duplicateEntryCount ? `\tduplicate-events=${duplicateEntryCount}` : '')
      return quarantine
        ? `${line}\tquarantined=${quarantine.entryCount};reasons=${quarantine.reasons.join(',')}`
        : line
    })
    .join('\n')
}
