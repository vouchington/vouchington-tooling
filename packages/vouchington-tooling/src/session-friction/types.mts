export type FrictionEventKind = 'sandbox-escalation' | 'sandbox-failure' | 'ambiguous-failure'

export type FrictionEvent = {
  kind: FrictionEventKind
  timestamp: string
  commandPrefix: string
  detail: string
  outcome?: 'requested' | 'approved' | 'denied' | 'unknown'
}

export type ToolResultObservation = {
  type: 'tool-result'
  command: string
  commandWrappers?: string[]
  permissionOutcome?: 'approved' | 'denied'
  escalationDetail?: string
  structuredStderr?: string
}

export type PermissionRequestObservation = {
  type: 'permission-request'
  command: string
  commandWrappers?: string[]
}

export type FrictionObservation = ToolResultObservation | PermissionRequestObservation

export type FrictionLogReadResult =
  | { status: 'absent' }
  | { status: 'empty'; truncated?: boolean; droppedCount?: number }
  | { status: 'events'; events: FrictionEvent[]; truncated?: boolean; droppedCount?: number }

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

export type SessionFrictionCoverage = {
  journalStatus: 'complete' | 'partial' | 'unavailable'
  frictionStatus: 'absent' | 'empty' | 'events' | 'unreadable'
  truncated: boolean
  droppedCount?: number
}
export type SessionFrictionReport = {
  coverage: SessionFrictionCoverage
  markdown: string
  diagnostic?: string
}

export type SessionFrictionReportOptions = FrictionLogOptions & {
  journalLoader: JournalLoader
}
