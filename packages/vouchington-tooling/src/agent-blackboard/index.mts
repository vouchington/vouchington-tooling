import type { FeedbackDeliveryResult } from './feedback-types.mts'
import { appendJournalMarkdown, checkJournalInput, type JournalInput } from './journal.mts'
import {
  loadClient,
  resolveBlackboardConnection,
  type BlackboardClientDependencies,
} from './client.mts'
import { readFile } from 'node:fs/promises'
import { assertSessionId } from './session-id.mts'

export { cleanupSnapshotPartitions, partitionSnapshot } from './snapshot.mts'
export { assertSessionId } from './session-id.mts'
export { appendJournalMarkdown } from './journal.mts'
export type { JournalInput } from './journal.mts'
export {
  archiveBlackboardSession,
  ensureBlackboardSession,
  exportSnapshot,
} from './session-tools.mts'
export type { EnsureSessionOutcome, SnapshotExportOutcome } from './session-tools.mts'
export type * from './snapshot-types.mts'

export async function probeBlackboard(
  env?: NodeJS.ProcessEnv,
  dependencies?: BlackboardClientDependencies,
): Promise<void> {
  const { Sessions } = await loadClient(dependencies)
  await new Sessions(resolveBlackboardConnection(env)).list({ limit: 1 })
}

export async function appendJournal(
  input: JournalInput & { markdownFile: string },
): Promise<FeedbackDeliveryResult> {
  const { markdownFile, ...journal } = input
  checkJournalInput(journal)
  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(markdownFile))
  } catch {
    throw new Error('note file is not valid UTF-8 or cannot be read')
  }
  if (!markdown) throw new Error('note file is empty')
  return appendJournalMarkdown({ ...journal, markdown })
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
export { feedbackOutboxStatus, readFeedbackOutbox } from './feedback-outbox.mts'
export { composeRetrospective } from './feedback-compose.mts'
export type { RetrospectiveCompositionInput, FeedbackAssessment } from './feedback-compose.mts'
export type { JournalAuditOptions } from './feedback-journal-audit.mts'
export type { JournalEntry, JournalLoader, JournalLoadResult } from '../session-friction/types.mts'
