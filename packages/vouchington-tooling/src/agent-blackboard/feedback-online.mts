import { feedbackDeadline } from './feedback-deadline.mts'
import { FeedbackDeliveryError, feedbackDiagnostic } from './feedback-online-error.mts'
import { canonicalFeedback } from './feedback-canonical.mts'
import { loadClient, resolveBlackboardConnection, type BlackboardClientModule } from './client.mts'
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
): Promise<{ createdAt: string } | undefined> {
  let count = 0
  let inspectedBytes = 0
  let found: { createdAt: string } | undefined
  for await (const entry of entries) {
    inspectedBytes += Buffer.byteLength(JSON.stringify(entry))
    if (++count > 10_000 || inspectedBytes > 2_000_000)
      throw new FeedbackDeliveryError('readback-unconfirmed')
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
      let connection
      try {
        connection = resolveBlackboardConnection(input.env)
        const url = new URL(connection.baseUrl)
        if (
          url.username ||
          url.password ||
          (url.protocol !== 'https:' &&
            !(
              url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
            ))
        )
          throw new Error('invalid connection URL')
      } catch {
        throw new FeedbackDeliveryError('configuration-invalid')
      }
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
      const existing = await findEvent(
        entries.get({ sessionId: input.identity.sessionId, format: 'jsonl' }),
        input.envelope,
      )
      if (existing && fresh) throw new FeedbackDeliveryError('event-conflict')
      if (existing)
        return {
          sessionId: input.identity.sessionId,
          sourceEventId: input.envelope.sourceEventId,
          createdAt: existing.createdAt,
          verified: true,
        }
      await entries.append({ sessionId: input.identity.sessionId, data: input.envelope })
      const confirmed = await findEvent(
        entries.get({ sessionId: input.identity.sessionId, format: 'jsonl' }),
        input.envelope,
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
