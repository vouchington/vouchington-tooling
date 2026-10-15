import { rejectUnknown, requiredString, type Args } from './args.mts'
import { outboxDirectory, type ToolContext } from './context.mts'
import { deliveryResponse } from './handlers-journal.mts'
import { previewRegistry } from './preview-registry.mts'
import { validateFeedbackEnvelope, writeFeedback } from '../agent-blackboard/index.mts'
import type { FeedbackEnvelope, FeedbackIdentity } from '../agent-blackboard/feedback-types.mts'

type Mode = 'interactive' | 'autonomous'

/** Writes a validated envelope through the same verified path as `journal_append`. */
export async function deliver(
  envelope: FeedbackEnvelope,
  identity: FeedbackIdentity,
  mode: Mode,
  context: ToolContext,
) {
  const directory = mode === 'interactive' ? outboxDirectory(context.worktree) : undefined
  const result = await writeFeedback({
    identity,
    envelope,
    mode,
    ...(directory === undefined ? {} : { outboxDirectory: directory }),
    env: context.env,
    dependencies: context.dependencies,
  })
  return deliveryResponse(result, context, mode)
}

/** The only arguments a token save takes: everything else was fixed by the dry run. */
const TOKEN_SAVE_ARGS = [
  'sessionId',
  'worktree',
  'parentSessionId',
  'agent',
  'version',
  'mode',
  'sourceEventId',
  'previewToken',
]

/**
 * Saves exactly the content a dry run previewed. The token is single use and bound to the
 * session, the worktree and the event id; an unknown, spent, restarted or mismatched token is
 * one error. The policy accepted this content at preview time, so it is not run again.
 */
export async function saveFromPreview(
  args: Args,
  context: ToolContext,
  identity: FeedbackIdentity,
  mode: Mode,
  sourceEventId: string,
) {
  rejectUnknown(args, TOKEN_SAVE_ARGS)
  const token = requiredString(args, 'previewToken')
  const preview = previewRegistry.take(token, {
    sessionId: context.sessionId,
    worktree: context.worktree,
    sourceEventId,
  })
  if (preview === undefined)
    throw new Error(
      'previewToken is unknown, already used, expired by a restart, or bound to a different ' +
        'session, worktree or sourceEventId: run the dry run again',
    )
  // The server owns the timestamp, as for every other write.
  const envelope = { ...preview.envelope, timestamp: new Date().toISOString() }
  try {
    validateFeedbackEnvelope(envelope)
    const response = await deliver(envelope, identity, mode, context)
    return { ...response, policy: { warnings: preview.warnings } }
  } catch (error) {
    // Nothing was stored, so the caller may retry with the same token.
    previewRegistry.restore(token, preview)
    throw error
  }
}
