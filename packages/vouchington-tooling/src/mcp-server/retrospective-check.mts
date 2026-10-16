import { validateFeedbackEnvelope } from '../agent-blackboard/index.mts'
import { optionalString } from './args.mts'
import type { ToolHandler } from './context.mts'
import { byCreatedAt } from './handlers-journal.mts'
import { readEntriesIfPresent } from './journal-read.mts'

type Data = {
  type?: unknown
  schemaVersion?: unknown
  sourceEventId?: unknown
  timestamp?: unknown
}

function retrospectiveData(entry: unknown): (Data & Record<string, unknown>) | undefined {
  const data = (entry as { data?: unknown } | null)?.data as Data | null | undefined
  if (data?.type !== 'retrospective') return undefined
  // A schema-versioned entry must be a valid envelope; unversioned legacy entries stay accepted.
  if (data.schemaVersion !== undefined) {
    try {
      validateFeedbackEnvelope(data)
    } catch {
      return undefined
    }
  }
  return data as Data & Record<string, unknown>
}

/** Whether the session already holds a retrospective, and which (sourceEventId, issues, prs). */
export const retrospectiveCheck: ToolHandler = async (args, context) => {
  const sourceEventId = optionalString(args, 'sourceEventId')
  const entries = await readEntriesIfPresent(context.sessionId, context.env, context.dependencies)
  const found = (entries ?? [])
    .toSorted(byCreatedAt)
    .flatMap((entry) => {
      const data = retrospectiveData(entry)
      return data === undefined ? [] : [data]
    })
    .filter((data) => sourceEventId === undefined || data.sourceEventId === sourceEventId)
    .map((data) => ({
      sourceEventId: data.sourceEventId,
      timestamp: data.timestamp,
      issues: data.issues ?? [],
      prs: data.prs ?? [],
    }))
  return { sessionId: context.sessionId, saved: found.length > 0, entries: found }
}
