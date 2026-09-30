import { createFeedbackEnvelope, normalizeRepositories } from './feedback-codec.mts'
import { writeFeedback } from './feedback-delivery.mts'
import { assertSessionId } from './session-id.mts'
import type {
  FeedbackCoverage,
  FeedbackDeliveryOptions,
  FeedbackDeliveryResult,
  FeedbackIdentity,
  WorkOutcome,
} from './feedback-types.mts'

export type JournalInput = Omit<FeedbackDeliveryOptions, 'identity' | 'envelope'> &
  FeedbackIdentity & {
    repositories: string[]
    sourceEventId: string
    workOutcome: WorkOutcome
    feedbackCoverage: FeedbackCoverage
    timestamp?: string
    category?: string
  }

/** Validates the identity, repositories, and timestamp before any note text is read. */
export function checkJournalInput(input: JournalInput): {
  repositories: string[]
  timestamp: Date
} {
  assertSessionId(input.sessionId)
  if (input.parentSessionId != null) assertSessionId(input.parentSessionId, 'parent session id')
  const repositories = normalizeRepositories(input.repositories)
  const timestamp = input.timestamp === undefined ? new Date() : new Date(input.timestamp)
  if (Number.isNaN(timestamp.valueOf()))
    throw new Error('journal timestamp is not a valid date-time')
  return { repositories, timestamp }
}

/**
 * Appends a journal entry whose markdown is already in memory. `appendJournal` reads a note file
 * and delegates here; callers that hold the text (for example the MCP server) skip the file.
 */
export async function appendJournalMarkdown(
  input: JournalInput & { markdown: string },
): Promise<FeedbackDeliveryResult> {
  const { repositories, timestamp } = checkJournalInput(input)
  return writeFeedback({
    identity: {
      sessionId: input.sessionId,
      parentSessionId: input.parentSessionId,
      agent: input.agent,
      version: input.version,
    },
    envelope: createFeedbackEnvelope({
      schemaVersion: 1,
      type: 'journal',
      sourceEventId: input.sourceEventId,
      timestamp: timestamp.toISOString(),
      repositories,
      markdown: input.markdown,
      workOutcome: input.workOutcome,
      feedbackCoverage: input.feedbackCoverage,
      ...(input.category === undefined ? {} : { category: input.category }),
    }),
    mode: input.mode,
    ...(input.outboxDirectory === undefined ? {} : { outboxDirectory: input.outboxDirectory }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  })
}
