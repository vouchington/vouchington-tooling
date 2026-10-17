import { inspectHarnessEnvironment, type HarnessId } from '../agent-harness-identity/index.mts'

const PRECEDENCE: readonly HarnessId[] = ['codex', 'claude', 'cursor', 'grok']

/**
 * The harness that launched this server, from the launch environment first and the MCP client's
 * `initialize` `clientInfo.name` second. Neither comes from a tool argument.
 */
export function deriveAgent(env: NodeJS.ProcessEnv, clientName?: string): HarnessId | undefined {
  const found = inspectHarnessEnvironment(env)
  const present: Record<HarnessId, boolean> = {
    codex: Boolean(found.codex.sessionId),
    claude: found.claude.compatMode || Boolean(found.claude.sessionId),
    cursor: found.cursor.agentMarker || Boolean(found.cursor.sessionId),
    grok: found.grok.agentMarker || found.grok.hookEvent || Boolean(found.grok.sessionId),
  }
  const fromEnv = PRECEDENCE.find((id) => present[id])
  if (fromEnv !== undefined) return fromEnv
  const name = clientName?.toLowerCase() ?? ''
  return PRECEDENCE.find((id) => name.includes(id))
}

/**
 * The text of the `Agent:` line before the session. The agent is the derived harness; a caller
 * `agent` that does not name it, or any `model`, is shown as caller-claimed and never replaces it.
 * With nothing derivable the agent is `unknown`.
 */
export function agentLabel(
  derived: HarnessId | undefined,
  claimedAgent: string | undefined,
  claimedModel: string | undefined,
): string {
  const notes: string[] = []
  const claim = claimedAgent?.trim()
  if (claim && !(derived !== undefined && claim.toLowerCase().includes(derived)))
    notes.push(`caller-claimed agent: ${claim}`)
  if (claimedModel) notes.push(`caller-claimed model: ${claimedModel}`)
  return `${derived ?? 'unknown'}${notes.length ? ` (${notes.join('; ')})` : ''}`
}
