import { join } from 'node:path'
import { assertSessionId } from '../agent-blackboard/session-id.mts'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import type { FeedbackIdentity } from '../agent-blackboard/feedback-types.mts'
import type { PolicySpawner } from './policy-spawn.mts'
import { requiredNullableString, requiredString, type Args } from './args.mts'

/** What a handler may rely on: every field here was validated before the handler ran. */
export type ToolContext = {
  sessionId: string
  worktree: string
  env: NodeJS.ProcessEnv
  dependencies: BlackboardClientDependencies
  /** The launch directory's worktree top level, or undefined when it is not inside one. */
  launchRoot: string | undefined
  /** Test seam: replaces the child process a policy export runs in. */
  spawnPolicy?: PolicySpawner
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

/** Policy modules run only for a server whose launch repository bounds the worktrees it acts on. */
export function assertPolicyAllowed(context: { launchRoot: string | undefined }): void {
  if (context.launchRoot === undefined)
    throw new Error(
      'policy tools require the server to be launched inside a repository worktree: relaunch ' +
        'it from the repository so the worktree argument is bound to that repository',
    )
}
