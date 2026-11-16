import {
  flushFeedbackOutbox,
  feedbackOutboxCounts,
  pruneRejectedFeedbackOutbox,
  readFeedbackFailures,
  readRejectedDetails,
} from '../agent-blackboard/index.mts'
import { outboxDirectory, type ToolHandler } from './context.mts'

/**
 * The outbox belongs to the worktree, not to one session, so two counts are reported. `pendingCount`
 * is the caller's session only; `worktreePendingCount` is every session's records.
 * `rejectedCount` and `worktreeRejectedCount` count permanently refused records kept for inspection.
 */
export function outboxCounts(
  worktree: string,
  sessionId: string,
): { pendingCount: number; worktreePendingCount: number } {
  const { pendingCount, worktreePendingCount } = statusCounts(worktree, sessionId)
  return { pendingCount, worktreePendingCount }
}

function statusCounts(
  worktree: string,
  sessionId: string,
): ReturnType<typeof feedbackOutboxCounts> {
  return feedbackOutboxCounts(outboxDirectory(worktree), sessionId)
}

function sessionStatus(pendingCount: number): 'empty' | 'pending' {
  return pendingCount === 0 ? 'empty' : 'pending'
}

/** Why each pending record last failed and why each kept record was rejected: causes only. */
function causes(worktree: string) {
  const directory = outboxDirectory(worktree)
  const failures = readFeedbackFailures(directory)
  const rejected = readRejectedDetails(directory).map(({ record, rejection }) => ({
    sourceEventId: record.envelope.sourceEventId,
    ...rejection,
  }))
  return {
    ...(failures.length === 0 ? {} : { failures }),
    ...(rejected.length === 0 ? {} : { rejected }),
  }
}

export const outboxStatus: ToolHandler = async (_args, context) => {
  const counts = statusCounts(context.worktree, context.sessionId)
  return {
    sessionId: context.sessionId,
    status: sessionStatus(counts.pendingCount),
    ...counts,
    ...causes(context.worktree),
  }
}

export const outboxPruneRejected: ToolHandler = async (args, context) => {
  const days = args.olderThanDays ?? 7
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0)
    throw new Error('olderThanDays must be a non-negative integer')
  const prunedCount = pruneRejectedFeedbackOutbox(outboxDirectory(context.worktree), days)
  return {
    sessionId: context.sessionId,
    prunedCount,
    ...statusCounts(context.worktree, context.sessionId),
  }
}

export const outboxFlush: ToolHandler = async (_args, context) => {
  // Flushing creates the outbox directory, so an empty or absent outbox is reported as is.
  const before = statusCounts(context.worktree, context.sessionId)
  if (before.worktreePendingCount === 0)
    return { sessionId: context.sessionId, status: 'empty', ...before, deliveredCount: 0 }
  // The flush delivers every session's records; only the counts below are per session.
  const flushed = await flushFeedbackOutbox({
    directory: outboxDirectory(context.worktree),
    env: context.env,
    dependencies: context.dependencies,
  })
  const counts = statusCounts(context.worktree, context.sessionId)
  return {
    sessionId: context.sessionId,
    ...flushed,
    status: sessionStatus(counts.pendingCount),
    ...counts,
  }
}
