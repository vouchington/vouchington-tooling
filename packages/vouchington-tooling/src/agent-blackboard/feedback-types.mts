import type { BlackboardClientDependencies } from './client.mts'
export type FeedbackMode = 'interactive' | 'autonomous'
export type WorkOutcome =
  | 'in-progress'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed-out'
  | 'no-change'
  | 'policy-refusal'
  | 'unknown'
export type FeedbackCoverage = {
  status: 'complete' | 'partial' | 'unavailable' | 'not-assessed' | 'not-started'
  sources: string[]
  droppedCount: number
}
export type FeedbackReference = string | number
export type FeedbackEnvelope = {
  schemaVersion: 1
  type: 'journal' | 'retrospective'
  sourceEventId: string
  timestamp: string
  repositories: string[]
  markdown: string
  workOutcome: WorkOutcome
  feedbackCoverage: FeedbackCoverage
  category?: string
  date?: string
  issues?: FeedbackReference[]
  prs?: FeedbackReference[]
}
export type FeedbackIdentity = {
  sessionId: string
  parentSessionId: string | null
  agent: string
  version: string
}
export type FeedbackReceipt = {
  sessionId: string
  sourceEventId: string
  createdAt: string
  verified: true
}
export type FeedbackDiagnostic =
  | 'blackboard-unavailable'
  | 'client-unavailable'
  | 'configuration-invalid'
  | 'authentication-rejected'
  | 'identity-conflict'
  | 'readback-unconfirmed'
  | 'event-conflict'
  | 'archived-session'
  | 'delivery-timeout'
export type FeedbackDeliveryResult =
  | { status: 'delivered'; sourceEventId: string; pendingCount: number; receipt: FeedbackReceipt }
  | {
      status: 'pending'
      sourceEventId: string
      pendingCount: number
      diagnostic: FeedbackDiagnostic
    }
export type FeedbackDeliveryOptions = {
  identity: FeedbackIdentity
  envelope: FeedbackEnvelope
  mode: FeedbackMode
  outboxDirectory?: string
  env?: NodeJS.ProcessEnv
  dependencies?: BlackboardClientDependencies
  timeoutMs?: number
}
export type FeedbackOnlineOptions = Omit<FeedbackDeliveryOptions, 'mode' | 'outboxDirectory'>
export type FeedbackOutboxRecord = { identity: FeedbackIdentity; envelope: FeedbackEnvelope }
export type FeedbackOutboxStatus = { status: 'empty' | 'pending'; pendingCount: number }
