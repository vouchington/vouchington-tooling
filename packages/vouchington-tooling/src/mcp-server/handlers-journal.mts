import {
  appendJournalMarkdown,
  feedbackOutboxStatus,
  flushFeedbackOutbox,
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
  // The envelope includes the timestamp, so a retry of one sourceEventId must reuse it. Fixing the
  // default here and returning it lets the caller do that.
  const timestamp = optionalString(args, 'timestamp') ?? new Date().toISOString()
  const category = optionalString(args, 'category')
  const result = await appendJournalMarkdown({
    ...identity,
    mode,
    // Interactive delivery needs a durable outbox; autonomous delivery forbids one.
    ...(mode === 'interactive' ? { outboxDirectory: outboxDirectory(context.worktree) } : {}),
    markdown: requiredString(args, 'markdown'),
    sourceEventId: requiredString(args, 'sourceEventId'),
    workOutcome: requiredChoice(args, 'workOutcome', OUTCOMES),
    repositories: requiredStringArray(args, 'repositories'),
    feedbackCoverage: readCoverage(args),
    timestamp,
    ...(category === undefined ? {} : { category }),
    env: context.env,
    dependencies: context.dependencies,
  })
  return { sessionId: context.sessionId, timestamp, ...result }
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

export const outboxStatus: ToolHandler = async (_args, context) => ({
  sessionId: context.sessionId,
  ...feedbackOutboxStatus(outboxDirectory(context.worktree)),
})

export const outboxFlush: ToolHandler = async (_args, context) => {
  const directory = outboxDirectory(context.worktree)
  // Flushing creates the outbox directory, so an empty or absent outbox is reported as is.
  if (feedbackOutboxStatus(directory).pendingCount === 0)
    return { sessionId: context.sessionId, status: 'empty', pendingCount: 0, deliveredCount: 0 }
  return {
    sessionId: context.sessionId,
    ...(await flushFeedbackOutbox({
      directory,
      env: context.env,
      dependencies: context.dependencies,
    })),
  }
}
