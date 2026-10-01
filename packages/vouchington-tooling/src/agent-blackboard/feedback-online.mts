import { feedbackDeadline } from './feedback-deadline.mts'
import { FeedbackDeliveryError, feedbackDiagnostic } from './feedback-online-error.mts'
import { canonicalFeedback } from './feedback-canonical.mts'
import { loadClient, type BlackboardClientModule } from './client.mts'
import { resolveFeedbackConnection } from './feedback-connection.mts'
import { boundedEntries } from './feedback-entry-bounds.mts'
import { normalizeRepositories, validateFeedbackEnvelope } from './feedback-codec.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
import { isObject } from './snapshot-partition-guards.mts'
import type { FeedbackEnvelope, FeedbackOnlineOptions, FeedbackReceipt } from './feedback-types.mts'
async function ensureSession(
  sessions: InstanceType<BlackboardClientModule['Sessions']>,
  identity: FeedbackOnlineOptions['identity'],
) {
  try {
    return await sessions.ensure({
      id: identity.sessionId,
      parentSessionId: identity.parentSessionId,
      agent: identity.agent,
      version: identity.version,
    })
  } catch (error) {
    let existing: unknown
    try {
      existing = await sessions.get(identity.sessionId)
    } catch {
      throw error
    }
    if (
      isObject(existing) &&
      existing.id === identity.sessionId &&
      (['parentSessionId', 'agent', 'version'] as const).some(
        (field) => (existing[field] ?? null) !== identity[field],
      )
    )
      throw new FeedbackDeliveryError('identity-conflict')
    throw error
  }
}
async function findEvent(
  entries: AsyncIterable<unknown>,
  envelope: FeedbackEnvelope,
  expectedCreatedAt?: string,
): Promise<{ createdAt: string } | undefined> {
  let found: { createdAt: string } | undefined
  let matching = 0
  for await (const entry of boundedEntries(entries)) {
    if (
      !isObject(entry) ||
      !isObject(entry.data) ||
      entry.data.sourceEventId !== envelope.sourceEventId
    )
      continue
    try {
      validateFeedbackEnvelope(entry.data)
    } catch {
      throw new FeedbackDeliveryError('event-conflict')
    }
    if (
      canonicalFeedback(entry.data) !== canonicalFeedback(envelope) ||
      typeof entry.createdAt !== 'string'
    )
      throw new FeedbackDeliveryError('event-conflict')
    if (++matching > 1 && expectedCreatedAt !== undefined)
      throw new FeedbackDeliveryError('event-conflict')
    if (expectedCreatedAt === undefined || entry.createdAt === expectedCreatedAt)
      found = { createdAt: entry.createdAt }
  }
  return found
}
export async function deliverFeedbackOnline(
  input: FeedbackOnlineOptions,
  fresh = false,
): Promise<FeedbackReceipt> {
  validateFeedbackIdentity(input.identity)
  validateFeedbackEnvelope(input.envelope)
  return feedbackDeadline(async () => {
    try {
      const connection = resolveFeedbackConnection(input.env)
      let client
      try {
        client = await loadClient(input.dependencies)
      } catch {
        throw new FeedbackDeliveryError('client-unavailable')
      }
      const { Sessions, Entries } = client
      const sessions = new Sessions(connection)
      const entries = new Entries(connection)
      const ensured = await ensureSession(sessions, input.identity)
      if (ensured.session.archivedAt != null) throw new FeedbackDeliveryError('archived-session')
      const existing = await findEvent(
        entries.get({ sessionId: input.identity.sessionId, format: 'jsonl' }),
        input.envelope,
      )
      if (existing && fresh) throw new FeedbackDeliveryError('event-conflict')
      const merged = [
        ...new Set([
          ...normalizeRepositories(ensured.session.data.repositories, false),
          ...input.envelope.repositories,
        ]),
      ].sort()
      if (JSON.stringify(ensured.session.data.repositories) !== JSON.stringify(merged))
        await sessions.patch({
          sessionId: input.identity.sessionId,
          data: { repositories: merged },
        })
      if (existing)
        return {
          sessionId: input.identity.sessionId,
          sourceEventId: input.envelope.sourceEventId,
          createdAt: existing.createdAt,
          verified: true,
        }
      const appended = await entries.append({
        sessionId: input.identity.sessionId,
        data: input.envelope,
      })
      if (
        fresh &&
        (!isObject(appended) ||
          typeof appended.createdAt !== 'string' ||
          !isObject(appended.data) ||
          canonicalFeedback(appended.data) !== canonicalFeedback(input.envelope))
      )
        throw new FeedbackDeliveryError('readback-unconfirmed')
      const confirmed = await findEvent(
        entries.get({ sessionId: input.identity.sessionId, format: 'jsonl' }),
        input.envelope,
        fresh ? appended.createdAt : undefined,
      )
      if (!confirmed) throw new FeedbackDeliveryError('readback-unconfirmed')
      return {
        sessionId: input.identity.sessionId,
        sourceEventId: input.envelope.sourceEventId,
        createdAt: confirmed.createdAt,
        verified: true,
      }
    } catch (error) {
      throw new FeedbackDeliveryError(feedbackDiagnostic(error))
    }
  }, input.timeoutMs)
}
