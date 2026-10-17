import {
  BlackboardNotInstalledError,
  loadClient,
  resolveBlackboardConnection,
  type BlackboardClientDependencies,
} from './client.mts'
import { assertSessionId } from './session-id.mts'

// SessionStart hook support: a hook prints its own session id, which every journal tool takes as
// an explicit `sessionId`, plus an advisory probe of the hosted deployment. The advisory can never
// stop an agent, and it cannot see whether a harness connected the MCP server.

export type SessionStartOptions = {
  /** The parsed hook payload; unparseable stdin is `{}`. */
  payload: Record<string, unknown>
  env?: NodeJS.ProcessEnv
  /** Environment variable that, when `1`, skips the probe only. Defaults to CHECK_BLACKBOARD_SKIP. */
  skipEnv?: string
  /** Appended to the workspace-setup advisory: how this repository repairs its install. */
  setupHint?: string
  /** Appended to the outage advisory: where this repository documents the deployment. */
  docsPath?: string
  /** How this repository restores a missing journal server; appended to the sandbox advisory. */
  restoreHint?: string
  /** Deadline for the probe in milliseconds. Defaults to 5000. */
  timeoutMs?: number
  /** Called when the probe deadline passes, so a caller can force exit past a hung request. */
  onTimeout?: () => void
  dependencies?: BlackboardClientDependencies
  /** Defaults to listing one session with the installed client. */
  probe?: (env?: NodeJS.ProcessEnv, dependencies?: BlackboardClientDependencies) => Promise<void>
}

const PAYLOAD_SESSION_KEYS = ['session_id', 'sessionId', 'conversation_id'] as const

/** The first valid, URL-safe session id in the payload, or undefined. */
export function payloadSessionId(payload: Record<string, unknown>): string | undefined {
  for (const key of PAYLOAD_SESSION_KEYS) {
    const value = payload[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > 256) continue
    try {
      assertSessionId(trimmed)
    } catch {
      continue
    }
    return trimmed
  }
  return undefined
}

async function listOneSession(
  env?: NodeJS.ProcessEnv,
  dependencies?: BlackboardClientDependencies,
): Promise<void> {
  const { Sessions } = await loadClient(dependencies)
  await new Sessions(resolveBlackboardConnection(env)).list({ limit: 1 })
}

/** Rejects when the promise has not settled by the deadline; the timer never holds the process. */
async function withDeadline(
  work: Promise<void>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(`timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref()
  })
  try {
    await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The advisory line for the deployment probe, or undefined when it is skipped or healthy. */
export async function probeAdvisory(options: SessionStartOptions): Promise<string | undefined> {
  const env = options.env ?? process.env
  if (options.payload.source === 'compact') return undefined
  if (env[options.skipEnv ?? 'CHECK_BLACKBOARD_SKIP'] === '1') return undefined
  // The Claude Code sandbox unsets AGENT_BLACKBOARD_TOKEN and blocks egress, so a sandboxed run
  // cannot tell "the deployment is down" from "I was never given the credential to check".
  if (env.SANDBOX_RUNTIME)
    return (
      'agent-blackboard probe skipped: it ran inside a sandbox, which withholds the deployment ' +
      'credential and egress. This is NOT an outage and NOT a reason to stop work. Do not rerun ' +
      'outside the sandbox to check. Journal through the journal server; search for ' +
      '`journal_append`. If it is not connected, ' +
      (options.restoreHint ??
        'reconnect it from the harness (`/mcp` in Claude Code, or restart Codex)') +
      ', and tell the user.'
    )
  try {
    await withDeadline(
      (options.probe ?? listOneSession)(env, options.dependencies),
      options.timeoutMs ?? 5000,
      options.onTimeout,
    )
  } catch (error) {
    const message = `sessions list probe failed: ${describe(error)}`
    if (error instanceof BlackboardNotInstalledError)
      return (
        `agent-blackboard helpers are unavailable (${message}). This is a workspace-setup ` +
        'problem in this worktree, not a deployment outage; AGENT_BLACKBOARD_URL and ' +
        `AGENT_BLACKBOARD_TOKEN are not the cause and do not need checking.${hint(options.setupHint)} ` +
        'Journaling does not need this install: search for `journal_append`, and when the server is ' +
        'not connected stop journaling and tell the user the server is unavailable and how to fix it.'
      )
    return (
      `agent-blackboard availability assessment failed (${message}). Interactive feedback can ` +
      'continue through the supported durable outbox; delivery remains visibly pending. Verify ' +
      'the hosted deployment is reachable and AGENT_BLACKBOARD_URL and AGENT_BLACKBOARD_TOKEN are ' +
      `exported and valid${options.docsPath ? ` (see ${options.docsPath})` : ''}, then start a ` +
      'fresh session. This probe does not show whether the journal server is connected; if it is ' +
      'not, stop journaling and tell the user the server is unavailable and how to fix it.'
    )
  }
  return undefined
}

function hint(text: string | undefined): string {
  return text ? ` ${text}` : ''
}

/** The `additionalContext` for a SessionStart hook, or undefined when there is nothing to say. */
export async function sessionStartContext(
  options: SessionStartOptions,
): Promise<string | undefined> {
  const lines: string[] = []
  const sessionId = payloadSessionId(options.payload)
  if (sessionId)
    lines.push(
      `Blackboard sessionId: ${sessionId} (pass it as \`sessionId\` to every journal tool)`,
    )
  const advisory = await probeAdvisory(options)
  if (advisory !== undefined) lines.push(advisory)
  return lines.length > 0 ? lines.join('\n') : undefined
}

export function sessionStartOutput(context: string): string {
  return `${JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  })}\n`
}
