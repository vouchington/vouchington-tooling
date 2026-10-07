import { assertSessionId } from './session-id.mts'
import { readFeedbackOutbox } from './feedback-outbox.mts'
import { readRejectedFeedbackOutbox } from './feedback-outbox-rejected.mts'

/** Counts a session separately from all retry records in the shared worktree outbox. Rejected
 * records are permanently refused notes kept for inspection; they are never pending. */
export function feedbackOutboxCounts(
  directory: string,
  sessionId: string,
): {
  pendingCount: number
  worktreePendingCount: number
  rejectedCount: number
  worktreeRejectedCount: number
} {
  assertSessionId(sessionId)
  const records = readFeedbackOutbox(directory)
  const rejected = readRejectedFeedbackOutbox(directory)
  return {
    pendingCount: records.filter((record) => record.identity.sessionId === sessionId).length,
    worktreePendingCount: records.length,
    rejectedCount: rejected.filter((record) => record.identity.sessionId === sessionId).length,
    worktreeRejectedCount: rejected.length,
  }
}
