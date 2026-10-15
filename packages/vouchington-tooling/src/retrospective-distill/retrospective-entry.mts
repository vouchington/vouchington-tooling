import type { SessionEntry } from 'agent-blackboard'

/** Whether a journal entry was written as a session retrospective. */
export function isRetrospectiveEntry(entry: SessionEntry): boolean {
  return entry.data.type === 'retrospective'
}
