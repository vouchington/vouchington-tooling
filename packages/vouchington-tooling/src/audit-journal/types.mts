export type JournalEntry = {
  data?: {
    type?: unknown
    markdown?: unknown
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
