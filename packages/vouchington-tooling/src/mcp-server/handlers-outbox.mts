import { flushFeedbackOutbox, readFeedbackOutbox } from '../agent-blackboard/index.mts'
import { outboxDirectory, type ToolHandler } from './context.mts'

/**
 * The outbox belongs to the worktree, not to one session, so two counts are reported. `pendingCount`
 * is the caller's session only; `worktreePendingCount` is every session's records.
 */
export function outboxCounts(
  worktree: string,
  sessionId: string,
): { pendingCount: number; worktreePendingCount: number } {
  // A read that never creates the directory, so asking about an empty outbox leaves no trace.
  const records = readFeedbackOutbox(outboxDirectory(worktree))
  return {
    pendingCount: records.filter((record) => record.identity.sessionId === sessionId).length,
    worktreePendingCount: records.length,
  }
}

function sessionStatus(pendingCount: number): 'empty' | 'pending' {
  return pendingCount === 0 ? 'empty' : 'pending'
}

export const outboxStatus: ToolHandler = async (_args, context) => {
  const counts = outboxCounts(context.worktree, context.sessionId)
  return { sessionId: context.sessionId, status: sessionStatus(counts.pendingCount), ...counts }
}

export const outboxFlush: ToolHandler = async (_args, context) => {
  // Flushing creates the outbox directory, so an empty or absent outbox is reported as is.
  if (outboxCounts(context.worktree, context.sessionId).worktreePendingCount === 0)
    return {
      sessionId: context.sessionId,
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 0,
      deliveredCount: 0,
    }
  // The flush delivers every session's records; only the counts below are per session.
  const flushed = await flushFeedbackOutbox({
    directory: outboxDirectory(context.worktree),
    env: context.env,
    dependencies: context.dependencies,
  })
  const counts = outboxCounts(context.worktree, context.sessionId)
  return {
    sessionId: context.sessionId,
    ...flushed,
    status: sessionStatus(counts.pendingCount),
    ...counts,
  }
}
