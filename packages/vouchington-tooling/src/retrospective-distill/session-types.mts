/** Structurally compatible with the agent-blackboard client's `Session`, so no client install is needed. */
export interface Session {
  id: string
  parentSessionId: string | null
  agent: string
  version: string
  createdAt: string
  lastEntryAt: string | null
  archivedAt: string | null
  data: Record<string, unknown>
}

/** Structurally compatible with the agent-blackboard client's `SessionEntry`. */
export interface SessionEntry {
  sessionId: string
  createdAt: string
  data: Record<string, unknown>
}
