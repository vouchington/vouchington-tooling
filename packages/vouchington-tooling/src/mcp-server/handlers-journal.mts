import {
  appendJournalMarkdown,
  readJournal,
  type FeedbackCoverage,
  type WorkOutcome,
} from '../agent-blackboard/index.mts'
import {
  optionalRecord,
  optionalString,
  requiredChoice,
  requiredString,
  requiredStringArray,
  rejectUnknown,
  type Args,
} from './args.mts'
import { outboxDirectory, readIdentity, type ToolHandler } from './context.mts'
import { outboxCounts } from './handlers-outbox.mts'

const MODES = ['interactive', 'autonomous'] as const
const OUTCOMES: readonly WorkOutcome[] = [
  'in-progress',
  'success',
  'failure',
  'cancelled',
  'timed-out',
  'no-change',
  'policy-refusal',
  'unknown',
]
const COVERAGE_STATUSES: readonly FeedbackCoverage['status'][] = [
  'complete',
  'partial',
  'unavailable',
  'not-assessed',
  'not-started',
]

function readCoverage(args: Args): FeedbackCoverage {
  const coverage = optionalRecord(args, 'feedbackCoverage')
  if (coverage === undefined) throw new Error('feedbackCoverage is required')
  rejectUnknown(coverage, ['status', 'sources', 'droppedCount'])
  const droppedCount = coverage.droppedCount ?? 0
  if (typeof droppedCount !== 'number' || !Number.isSafeInteger(droppedCount) || droppedCount < 0)
    throw new Error('feedbackCoverage.droppedCount must be a non-negative integer')
  const sources = coverage.sources ?? []
  if (!Array.isArray(sources) || sources.some((source) => typeof source !== 'string'))
    throw new Error('feedbackCoverage.sources must be an array of strings')
  return {
    status: requiredChoice(coverage, 'status', COVERAGE_STATUSES),
    sources: sources as string[],
    droppedCount,
  }
}

export const journalAppend: ToolHandler = async (args, context) => {
  const identity = readIdentity(args, context.sessionId)
  const mode = requiredChoice(args, 'mode', MODES)
  const sourceEventId = requiredString(args, 'sourceEventId')
  const category = optionalString(args, 'category')
  const entry = {
    markdown: requiredString(args, 'markdown'),
    workOutcome: requiredChoice(args, 'workOutcome', OUTCOMES),
    repositories: requiredStringArray(args, 'repositories'),
    feedbackCoverage: readCoverage(args),
  }
  // Interactive delivery needs a durable outbox; autonomous delivery forbids one.
  const directory = mode === 'interactive' ? outboxDirectory(context.worktree) : undefined
  const result = await appendJournalMarkdown({
    ...identity,
    ...entry,
    mode,
    sourceEventId,
    ...(directory === undefined ? {} : { outboxDirectory: directory }),
    ...(category === undefined ? {} : { category }),
    env: context.env,
    dependencies: context.dependencies,
  })
  // The server owns the timestamp: a first append takes the current time, and a retry of the same
  // event (same session, sourceEventId, and content) reports the one already stored or retained.
  const timestamp = result.status === 'delivered' ? result.receipt.timestamp : result.timestamp
  // Autonomous delivery never uses an outbox, so it has nothing pending. Interactive delivery
  // reports the outbox as it is after delivery, split into the caller's session and the worktree.
  const counts =
    mode === 'interactive'
      ? outboxCounts(context.worktree, context.sessionId)
      : { pendingCount: 0, worktreePendingCount: 0 }
  return { sessionId: context.sessionId, ...result, timestamp, ...counts }
}

// `Entries.get` documents no order, and `createdAt` is a service-generated ISO 8601 UTC time whose
// text order is time order. An entry without a usable `createdAt` sorts first rather than throwing.
function createdAtOf(entry: unknown): string {
  const createdAt = (entry as { createdAt?: unknown } | null)?.createdAt
  return typeof createdAt === 'string' ? createdAt : ''
}

function byCreatedAt(left: unknown, right: unknown): number {
  const leftAt = createdAtOf(left)
  const rightAt = createdAtOf(right)
  if (leftAt === rightAt) return 0
  return leftAt < rightAt ? -1 : 1
}

/** Every entry as the client returns it, oldest first. Nothing is filtered or rewritten. */
export const journalEntries: ToolHandler = async (_args, context) => ({
  sessionId: context.sessionId,
  entries: (await readJournal(context.sessionId, context.env, context.dependencies)).toSorted(
    byCreatedAt,
  ),
})
