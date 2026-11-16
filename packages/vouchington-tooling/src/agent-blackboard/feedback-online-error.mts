import { isObject } from './snapshot-partition-guards.mts'
import { causeOfError, type FeedbackCause } from './feedback-failure.mts'
import type { FeedbackDiagnostic } from './feedback-types.mts'
export class FeedbackDeliveryError extends Error {
  readonly status = 'blocked'
  readonly diagnostic: FeedbackDiagnostic
  /** The non-secret cause; it defaults to the diagnostic itself. */
  readonly failure: FeedbackCause
  constructor(diagnostic: FeedbackDiagnostic, detail?: string, failure?: FeedbackCause) {
    super(`Blackboard feedback blocked: ${diagnostic}${detail === undefined ? '' : `: ${detail}`}`)
    this.name = 'FeedbackDeliveryError'
    this.diagnostic = diagnostic
    this.failure = failure ?? { cause: diagnostic }
  }
}
export function feedbackDiagnostic(error: unknown): FeedbackDiagnostic {
  if (error instanceof FeedbackDeliveryError) return error.diagnostic
  if (
    isObject(error) &&
    (error.status === 401 ||
      error.status === 403 ||
      error.statusCode === 401 ||
      error.statusCode === 403)
  )
    return 'authentication-rejected'
  if (isObject(error) && (error.status === 409 || error.statusCode === 409))
    return 'identity-conflict'
  return 'blackboard-unavailable'
}
export function feedbackFailure(error: unknown): FeedbackCause {
  return error instanceof FeedbackDeliveryError ? error.failure : causeOfError(error)
}
