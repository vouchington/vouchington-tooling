import { join } from 'node:path'
import { assertSessionId } from '../agent-blackboard/session-id.mts'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import { validateFeedbackIdentity } from '../agent-blackboard/feedback-identity.mts'
import type { FeedbackIdentity } from '../agent-blackboard/feedback-types.mts'
import type { RunTextCommand } from '../gh-cli/exec.mts'
import type { GhRunner } from './pr-gh.mts'
import type { PolicySpawner } from './policy-spawn.mts'
import type { SnapshotRegistry } from './snapshot-registry.mts'
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
  /** The server's record of its own exports, which `snapshot_cleanup` is bound to. */
  snapshots: SnapshotRegistry
  /** Runs git with the isolated environment; callers add their own `-C <worktree>`. */
  runGit: RunTextCommand
  /** Test seam: replaces locating and running gh. */
  runGh?: GhRunner
  /** The connected MCP client's `clientInfo.name`, once `initialize` has completed. */
  clientName?: () => string | undefined
  /** Test seam: replaces the operating system user and host name. */
  device?: () => { user: string; host: string }
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

/** The caller identity, fully validated before any policy runs or anything is written. */
export function readIdentity(args: Args, sessionId: string): FeedbackIdentity {
  const identity = {
    sessionId,
    parentSessionId: requiredNullableString(args, 'parentSessionId'),
    agent: requiredString(args, 'agent'),
    version: requiredString(args, 'version'),
  }
  validateFeedbackIdentity(identity)
  return identity
}

/** Policy modules run only for a server whose launch repository bounds the worktrees it acts on. */
export function assertPolicyAllowed(context: { launchRoot: string | undefined }): void {
  // Policy and facts children are reaped by Unix process group; Windows has no equivalent here.
  if (process.platform === 'win32')
    throw new Error('policy tools are not supported on Windows: run the server on macOS or Linux')
  if (context.launchRoot === undefined)
    throw new Error(
      'policy tools require the server to be launched inside a repository worktree: relaunch ' +
        'it from the repository so the worktree argument is bound to that repository',
    )
}
