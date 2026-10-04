import { FeedbackDeliveryError, type FeedbackDiagnostic } from '../agent-blackboard/index.mts'
import type { BlackboardClientDependencies } from '../agent-blackboard/client.mts'
import type { RunTextCommand } from '../gh-cli/exec.mts'
import { optionalString, rejectUnknown, requireObject } from './args.mts'
import { readSessionId, type ToolHandler } from './context.mts'
import { journalAppend, journalEntries } from './handlers-journal.mts'
import { outboxFlush, outboxStatus } from './handlers-outbox.mts'
import { sessionArchive, sessionEnsure, snapshotExport } from './handlers-session.mts'
import { TOOLS } from './tools.mts'
import { resolveWorktree } from './worktree.mts'

export type ServerEnvironment = {
  /** The launch directory's worktree top level, or undefined when it is not inside one. */
  launchRoot: string | undefined
  env: NodeJS.ProcessEnv
  runGit: RunTextCommand
  /** Test seam: where `agent-blackboard` resolves from. Defaults to this package's own module. */
  resolveFrom?: string | URL
  /** Test seam: replaces how the consumer's `agent-blackboard` client is loaded. */
  blackboard?: BlackboardClientDependencies
}

export type ToolCallResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: true
}

const HANDLERS: Record<string, ToolHandler> = {
  journal_append: journalAppend,
  journal_entries: journalEntries,
  outbox_status: outboxStatus,
  outbox_flush: outboxFlush,
  session_ensure: sessionEnsure,
  snapshot_export: snapshotExport,
  session_archive: sessionArchive,
}

const DIAGNOSTIC_HINTS: Record<FeedbackDiagnostic, string> = {
  'identity-conflict': 'the session already exists with a different parent, agent, or version',
  'event-conflict':
    'sourceEventId was already used with different content; use a new sourceEventId',
  'archived-session': 'the session is archived; write to a new session',
  'authentication-rejected': 'the blackboard rejected AGENT_BLACKBOARD_TOKEN',
  'blackboard-unavailable': 'the blackboard could not be reached or returned an error',
  'configuration-invalid': 'AGENT_BLACKBOARD_URL or AGENT_BLACKBOARD_TOKEN is missing or invalid',
  'client-unavailable': 'agent-blackboard is not installed next to vouchington-tooling',
  'readback-unconfirmed':
    'the write could not be confirmed; retry the same call (same sourceEventId and content)',
  'delivery-timeout': 'delivery timed out; retry the same call (same sourceEventId and content)',
}

function describeError(error: unknown): string {
  if (error instanceof FeedbackDeliveryError)
    return `${error.message} (${DIAGNOSTIC_HINTS[error.diagnostic]})`
  return error instanceof Error ? error.message : String(error)
}

/** Runs one tool call. Every failure becomes an MCP tool error; nothing here throws. */
export async function callTool(
  name: string,
  rawArguments: unknown,
  environment: ServerEnvironment,
): Promise<ToolCallResult> {
  try {
    const definition = TOOLS.find((candidate) => candidate.name === name)
    const handler = HANDLERS[name]
    if (!definition || !handler)
      throw new Error(
        `unknown tool ${name}; available: ${TOOLS.map((tool) => tool.name).join(', ')}`,
      )
    const args = requireObject(rawArguments ?? {})
    rejectUnknown(args, Object.keys(definition.inputSchema.properties))
    // Everything below this line may touch disk or the network, so identity comes first.
    const sessionId = readSessionId(args)
    const worktree = await resolveWorktree({
      launchRoot: environment.launchRoot,
      requested: optionalString(args, 'worktree'),
      runGit: environment.runGit,
    })
    const result = await handler(args, {
      sessionId,
      worktree,
      env: environment.env,
      // The client resolves from this package's install, like the SDK, never from the worktree.
      dependencies: {
        ...environment.blackboard,
        resolveFrom: environment.resolveFrom ?? import.meta.url,
      },
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: describeError(error) }] }
  }
}
