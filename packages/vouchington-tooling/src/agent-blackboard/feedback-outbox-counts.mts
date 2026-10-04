import { assertSessionId } from './session-id.mts'
import { readFeedbackOutbox } from './feedback-outbox.mts'

/** Counts a session separately from all retry records in the shared worktree outbox. */
export function feedbackOutboxCounts(
  directory: string,
  sessionId: string,
): { pendingCount: number; worktreePendingCount: number } {
  assertSessionId(sessionId)
  const records = readFeedbackOutbox(directory)
  return {
    pendingCount: records.filter((record) => record.identity.sessionId === sessionId).length,
    worktreePendingCount: records.length,
  }
}
