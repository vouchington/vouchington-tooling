import { createFeedbackEnvelope, normalizeRepositories } from './feedback-codec.mts'
import { writeFeedback } from './feedback-delivery.mts'
import type {
  FeedbackCoverage,
  FeedbackDeliveryOptions,
  FeedbackDeliveryResult,
  FeedbackIdentity,
  WorkOutcome,
} from './feedback-types.mts'
import {
  loadClient,
  resolveBlackboardConnection,
  type BlackboardClientDependencies,
} from './client.mts'
import { readFile } from 'node:fs/promises'
import { assertSessionId } from './session-id.mts'

export { cleanupSnapshotPartitions, partitionSnapshot } from './snapshot.mts'
export { assertSessionId } from './session-id.mts'
export type * from './snapshot-types.mts'

export async function probeBlackboard(
  env?: NodeJS.ProcessEnv,
  dependencies?: BlackboardClientDependencies,
): Promise<void> {
  const { Sessions } = await loadClient(dependencies)
  await new Sessions(resolveBlackboardConnection(env)).list({ limit: 1 })
}

export async function appendJournal(
  input: Omit<FeedbackDeliveryOptions, 'identity' | 'envelope'> &
    FeedbackIdentity & {
      repositories: string[]
      markdownFile: string
      sourceEventId: string
      workOutcome: WorkOutcome
      feedbackCoverage: FeedbackCoverage
      timestamp?: string
      category?: string
    },
): Promise<FeedbackDeliveryResult> {
  assertSessionId(input.sessionId)
  if (input.parentSessionId != null) assertSessionId(input.parentSessionId, 'parent session id')
  const repositories = normalizeRepositories(input.repositories)
  const timestamp = input.timestamp === undefined ? new Date() : new Date(input.timestamp)
  if (Number.isNaN(timestamp.valueOf()))
    throw new Error('journal timestamp is not a valid date-time')
  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(input.markdownFile))
  } catch {
    throw new Error('note file is not valid UTF-8 or cannot be read')
  }
  if (!markdown) throw new Error('note file is empty')
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
      markdown,
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

export async function readJournal(
  sessionId: string,
  env?: NodeJS.ProcessEnv,
  dependencies?: BlackboardClientDependencies,
): Promise<unknown[]> {
  assertSessionId(sessionId)
  const { Entries } = await loadClient(dependencies)
  const entries: unknown[] = []
  for await (const entry of new Entries(resolveBlackboardConnection(env)).get({
    sessionId,
    format: 'json',
  }))
    entries.push(entry)
  return entries
}

export function formatJournalEntries(sessionId: string, entries: unknown[]): string {
  const journals = entries.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('createdAt' in entry) ||
      !('data' in entry) ||
      typeof entry.createdAt !== 'string' ||
      typeof entry.data !== 'object' ||
      entry.data === null ||
      !('type' in entry.data) ||
      !('markdown' in entry.data) ||
      entry.data.type !== 'journal' ||
      typeof entry.data.markdown !== 'string'
    )
      return []
    return [{ createdAt: entry.createdAt, markdown: entry.data.markdown }]
  })
  if (!journals.length) return `No journal entries found for session ${sessionId}.`
  return journals
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(({ createdAt, markdown }) => `## ${createdAt}\n\n${markdown}`)
    .join('\n\n')
}

export { resolveBlackboardConnection } from './client.mts'
export type {
  BlackboardConnection,
  BlackboardClientModule,
  BlackboardClientDependencies,
} from './client.mts'
export type * from './feedback-types.mts'
export { createFeedbackEnvelope, validateFeedbackEnvelope } from './feedback-codec.mts'
export {
  writeFeedback,
  verifyFreshFeedback,
  flushFeedbackOutbox,
  FeedbackDeliveryError,
} from './feedback-delivery.mts'
export { feedbackOutboxStatus } from './feedback-outbox.mts'
export { composeRetrospective } from './feedback-compose.mts'
export type { RetrospectiveCompositionInput, FeedbackAssessment } from './feedback-compose.mts'
