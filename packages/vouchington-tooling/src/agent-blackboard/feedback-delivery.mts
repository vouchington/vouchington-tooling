import type { BlackboardClientDependencies } from './client.mts'
import { createFeedbackEnvelope, validateFeedbackEnvelope } from './feedback-codec.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
import { deliverFeedbackOnline } from './feedback-online.mts'
import { feedbackDiagnostic, feedbackFailure } from './feedback-online-error.mts'
import { isTransientCause, type FeedbackCause } from './feedback-failure.mts'
import { recordFeedbackFailure, type FeedbackFailureReport } from './feedback-outbox-failure.mts'
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
      rejectFeedbackOutbox(input.outboxDirectory, record, {
        diagnostic,
        ...feedbackFailure(error),
      })
      throw error
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
type FeedbackRejected = {
  sourceEventId: string
  diagnostic: FeedbackDiagnostic
} & FeedbackCause & {
    attempts?: number
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
  rejected?: FeedbackRejected[]
  /** Records still pending that failed this flush, with their non-secret cause and attempt count. */
  failures?: FeedbackFailureReport[]
  cleanupDiagnostic?: 'outbox-cleanup-failed'
}> {
  let deliveredCount = 0
  let diagnostic: FeedbackDiagnostic | undefined
  let cleanupDiagnostic: 'outbox-cleanup-failed' | undefined
  const rejected: FeedbackRejected[] = []
  const failures: FeedbackFailureReport[] = []
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
      const cause = feedbackFailure(error)
      const sourceEventId = record.envelope.sourceEventId
      if (PERMANENT.includes(current)) {
        rejectFeedbackOutbox(input.directory, record, { diagnostic: current, ...cause })
        rejected.push({ sourceEventId, diagnostic: current, ...cause })
        continue
      }
      const { failure, quarantined } = recordFeedbackFailure(input.directory, record, cause)
      if (quarantined) {
        rejected.push({ sourceEventId, diagnostic: 'delivery-quarantined', ...failure })
        continue
      }
      failures.push({ sourceEventId, ...failure })
      diagnostic = current
      // A record-specific failure must not starve the records behind it; an outage ends the flush.
      if (isTransientCause(cause.cause)) break
    }
  }
  return {
    ...feedbackOutboxStatus(input.directory),
    deliveredCount,
    ...(cleanupDiagnostic === undefined ? {} : { cleanupDiagnostic }),
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...(rejected.length === 0 ? {} : { rejected }),
    ...(failures.length === 0 ? {} : { failures }),
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
