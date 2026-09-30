import { join } from 'node:path'
import { assertSessionId } from '../agent-blackboard/session-id.mts'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import type { FeedbackIdentity } from '../agent-blackboard/feedback-types.mts'
import { requiredNullableString, requiredString, type Args } from './args.mts'

/** What a handler may rely on: every field here was validated before the handler ran. */
type ToolContext = {
  sessionId: string
  worktree: string
  env: NodeJS.ProcessEnv
  dependencies: BlackboardClientDependencies
}

export type ToolHandler = (args: Args, context: ToolContext) => Promise<Record<string, unknown>>

/**
 * The consumer convention for the interactive outbox. It is derived, never accepted from the
 * caller, so a credentialed, unsandboxed server cannot be pointed at an arbitrary directory.
 */
export function outboxDirectory(worktree: string): string {
  return join(worktree, '.local', 'blackboard-outbox')
}

export function readSessionId(args: Args): string {
  const value = requiredString(args, 'sessionId')
  assertSessionId(value)
  return value
}

export function readIdentity(args: Args, sessionId: string): FeedbackIdentity {
  return {
    sessionId,
    parentSessionId: requiredNullableString(args, 'parentSessionId'),
    agent: requiredString(args, 'agent'),
    version: requiredString(args, 'version'),
  }
}
