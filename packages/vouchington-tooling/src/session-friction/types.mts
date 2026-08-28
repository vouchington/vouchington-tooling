export type FrictionEventKind = 'sandbox-escalation' | 'sandbox-failure'

export type FrictionEvent = {
  kind: FrictionEventKind
  timestamp: string
  commandPrefix: string
  detail: string
}

export type ToolResultObservation = {
  type: 'tool-result'
  command: string
  escalationDetail?: string
  structuredStderr?: string
}

export type PermissionRequestObservation = {
  type: 'permission-request'
  command: string
}

export type FrictionObservation = ToolResultObservation | PermissionRequestObservation

export type FrictionLogReadResult =
  | { status: 'absent' }
  | { status: 'empty' }
  | { status: 'events'; events: FrictionEvent[] }

export type FrictionLogOptions = {
  directory: string
  maxEvents?: number
}

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

export type SessionFrictionReport = {
  markdown: string
  diagnostic?: string
}

export type SessionFrictionReportOptions = FrictionLogOptions & {
  journalLoader: JournalLoader
}
