export type JournalEntry = {
  /** Service-generated ISO 8601 UTC time the entry was created, as the blackboard returns it. */
  createdAt?: unknown
  data?: {
    type?: unknown
    markdown?: unknown
    sourceEventId?: unknown
  }
}

export type JournalLoadResult =
  | { status: 'ok'; entries: Iterable<JournalEntry> | AsyncIterable<JournalEntry> }
  | { status: 'not-found' }

export type JournalLoader = (sessionId: string) => JournalLoadResult | Promise<JournalLoadResult>

export type AuditCoverage = {
  journalStatus: 'complete' | 'partial' | 'unavailable'
  truncated: boolean
}
