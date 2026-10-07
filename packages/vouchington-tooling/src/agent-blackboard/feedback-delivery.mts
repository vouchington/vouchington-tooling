import type { BlackboardClientDependencies } from './client.mts'
import { createFeedbackEnvelope, validateFeedbackEnvelope } from './feedback-codec.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
import { deliverFeedbackOnline } from './feedback-online.mts'
import { FeedbackDeliveryError, feedbackDiagnostic } from './feedback-online-error.mts'
import {
  feedbackOutboxStatus,
  listFeedbackOutbox,
  persistFeedbackOutbox,
  removeFeedbackOutbox,
} from './feedback-outbox.mts'
import { rejectFeedbackOutbox } from './feedback-outbox-rejected.mts'
import type {
  FeedbackDeliveryOptions,
  FeedbackDeliveryResult,
  FeedbackDiagnostic,
  FeedbackOnlineOptions,
} from './feedback-types.mts'
export { FeedbackDeliveryError } from './feedback-online-error.mts'
const PERMANENT: FeedbackDiagnostic[] = ['identity-conflict', 'event-conflict', 'archived-session']
export async function writeFeedback(
  input: FeedbackDeliveryOptions,
): Promise<FeedbackDeliveryResult> {
  if (input.mode !== 'interactive' && input.mode !== 'autonomous')
    throw new Error('feedback mode must be explicitly interactive or autonomous')
  validateFeedbackIdentity(input.identity)
  validateFeedbackEnvelope(input.envelope)
  const envelope = prepareEnvelope(input)
  if (input.mode === 'autonomous') {
    if (input.outboxDirectory !== undefined)
      throw new Error('autonomous feedback cannot use a filesystem outbox')
    const receipt = await deliverFeedbackOnline({ ...input, envelope })
    return { status: 'delivered', sourceEventId: envelope.sourceEventId, pendingCount: 0, receipt }
  }
  if (!input.outboxDirectory)
    throw new Error('interactive feedback requires an explicit durable outbox directory')
  // A retained record for the same event keeps its own timestamp and is the one delivered.
  const record = persistFeedbackOutbox(input.outboxDirectory, {
    identity: input.identity,
    envelope,
  })
  try {
    const receipt = await deliverFeedbackOnline({ ...input, envelope: record.envelope })
    const cleanup = removeFeedbackOutbox(input.outboxDirectory, record)
    return { status: 'delivered', sourceEventId: envelope.sourceEventId, ...cleanup, receipt }
  } catch (error) {
    const diagnostic = feedbackDiagnostic(error)
    if (PERMANENT.includes(diagnostic)) {
      rejectFeedbackOutbox(input.outboxDirectory, record)
      throw new FeedbackDeliveryError(diagnostic)
    }
    return {
      status: 'pending',
      sourceEventId: envelope.sourceEventId,
      timestamp: record.envelope.timestamp,
      pendingCount: feedbackOutboxStatus(input.outboxDirectory).pendingCount,
      diagnostic,
    }
  }
}
export async function verifyFreshFeedback(
  input: FeedbackOnlineOptions,
): Promise<Extract<FeedbackDeliveryResult, { status: 'delivered' }>> {
  const envelope = prepareEnvelope(input)
  const receipt = await deliverFeedbackOnline({ ...input, envelope }, true)
  return { status: 'delivered', sourceEventId: envelope.sourceEventId, pendingCount: 0, receipt }
}
export async function flushFeedbackOutbox(input: {
  directory: string
  env?: NodeJS.ProcessEnv
  dependencies?: BlackboardClientDependencies
}): Promise<{
  status: 'empty' | 'pending'
  pendingCount: number
  deliveredCount: number
  diagnostic?: FeedbackDiagnostic
  rejected?: Array<{ sourceEventId: string; diagnostic: FeedbackDiagnostic }>
  cleanupDiagnostic?: 'outbox-cleanup-failed'
}> {
  let deliveredCount = 0
  let diagnostic: FeedbackDiagnostic | undefined
  let cleanupDiagnostic: 'outbox-cleanup-failed' | undefined
  const rejected: Array<{ sourceEventId: string; diagnostic: FeedbackDiagnostic }> = []
  for (const record of listFeedbackOutbox(input.directory)) {
    try {
      await deliverFeedbackOnline({
        ...record,
        ...(input.env === undefined ? {} : { env: input.env }),
        ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
      })
      const cleanup = removeFeedbackOutbox(input.directory, record)
      cleanupDiagnostic ??= cleanup.cleanupDiagnostic
      deliveredCount++
    } catch (error) {
      const current = feedbackDiagnostic(error)
      if (PERMANENT.includes(current)) {
        rejectFeedbackOutbox(input.directory, record)
        rejected.push({ sourceEventId: record.envelope.sourceEventId, diagnostic: current })
        continue
      }
      diagnostic = current
      break
    }
  }
  return {
    ...feedbackOutboxStatus(input.directory),
    deliveredCount,
    ...(cleanupDiagnostic === undefined ? {} : { cleanupDiagnostic }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...(rejected.length === 0 ? {} : { rejected }),
  }
}

function prepareEnvelope(input: FeedbackOnlineOptions) {
  const token = (input.env ?? process.env).AGENT_BLACKBOARD_TOKEN
  const envelope = createFeedbackEnvelope(input.envelope, {
    knownSensitiveValues: token ? [token] : [],
  })
  if (
    token &&
    token.length >= 4 &&
    JSON.stringify({ identity: input.identity, envelope }).includes(token)
  )
    throw new Error('feedback identity contains a configured sensitive value')
  return envelope
}
