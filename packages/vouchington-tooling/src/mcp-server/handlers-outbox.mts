import { flushFeedbackOutbox, feedbackOutboxCounts } from '../agent-blackboard/index.mts'
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

export const outboxStatus: ToolHandler = async (_args, context) => {
  const counts = statusCounts(context.worktree, context.sessionId)
  return { sessionId: context.sessionId, status: sessionStatus(counts.pendingCount), ...counts }
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
