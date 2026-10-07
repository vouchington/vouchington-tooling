import { isObject } from './snapshot-partition-guards.mts'
import type { FeedbackDiagnostic } from './feedback-types.mts'
export class FeedbackDeliveryError extends Error {
  readonly status = 'blocked'
  readonly diagnostic: FeedbackDiagnostic
  constructor(diagnostic: FeedbackDiagnostic, detail?: string) {
    super(`Blackboard feedback blocked: ${diagnostic}${detail === undefined ? '' : `: ${detail}`}`)
    this.name = 'FeedbackDeliveryError'
    this.diagnostic = diagnostic
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
