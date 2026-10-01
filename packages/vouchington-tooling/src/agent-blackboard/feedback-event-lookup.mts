import { loadClient, type BlackboardClientDependencies } from './client.mts'
import { resolveFeedbackConnection } from './feedback-connection.mts'
import { feedbackDeadline } from './feedback-deadline.mts'
import { boundedEntries } from './feedback-entry-bounds.mts'
import { readFeedbackOutbox } from './feedback-outbox.mts'
import { isObject } from './snapshot-partition-guards.mts'

// The lookup only decides which timestamp a retry reuses. It must not hold up the append for the
// full delivery deadline, so it gets a short one of its own.
const LOOKUP_TIMEOUT_MS = 5_000

export type FeedbackEventLookup = {
  sessionId: string
  sourceEventId: string
  /** Set for interactive delivery; the durable outbox is searched before the remote session. */
  outboxDirectory?: string
  env?: NodeJS.ProcessEnv
  dependencies?: BlackboardClientDependencies
  timeoutMs?: number
}

function canonicalTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
    ? value
    : undefined
}

function fromOutbox(directory: string, input: FeedbackEventLookup): string | undefined {
  try {
    return readFeedbackOutbox(directory).find(
      (record) =>
        record.identity.sessionId === input.sessionId &&
        record.envelope.sourceEventId === input.sourceEventId,
    )?.envelope.timestamp
  } catch {
    return undefined
  }
}

async function fromRemote(input: FeedbackEventLookup): Promise<string | undefined> {
  try {
    return await feedbackDeadline(async () => {
      const connection = resolveFeedbackConnection(input.env)
      const { Entries } = await loadClient(input.dependencies)
      const entries = new Entries(connection).get({ sessionId: input.sessionId, format: 'jsonl' })
      for await (const entry of boundedEntries(entries)) {
        if (!isObject(entry) || !isObject(entry.data)) continue
        if (entry.data.sourceEventId !== input.sourceEventId) continue
        const timestamp = canonicalTimestamp(entry.data.timestamp)
        if (timestamp !== undefined) return timestamp
      }
      return undefined
    }, input.timeoutMs ?? LOOKUP_TIMEOUT_MS)
  } catch {
    return undefined
  }
}

/**
 * The timestamp already recorded for a session's source event, so a retry rebuilds the same
 * envelope. The durable outbox is searched first, then the remote session. A lookup that cannot
 * finish (offline, unconfigured, oversized history) reports nothing rather than failing the
 * caller: the first append of an event is allowed to mint its own timestamp, and a changed
 * envelope under an existing event id is still rejected by delivery.
 */
export async function findFeedbackEventTimestamp(
  input: FeedbackEventLookup,
): Promise<string | undefined> {
  const local =
    input.outboxDirectory === undefined ? undefined : fromOutbox(input.outboxDirectory, input)
  return local ?? fromRemote(input)
}
