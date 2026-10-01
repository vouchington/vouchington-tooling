import type { FeedbackEnvelope } from './feedback-types.mts'
import { isObject } from './snapshot-partition-guards.mts'
export function canonicalFeedback(value: unknown): string {
  return JSON.stringify(ordered(value))
}
/**
 * The identity of a feedback event is its session, `sourceEventId`, and content. The `timestamp` is
 * assigned by the server on each attempt, so a retry that differs only in `timestamp` is the same
 * event and is left out of the comparison.
 */
export function canonicalFeedbackEvent(envelope: FeedbackEnvelope): string {
  return canonicalFeedback(
    Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'timestamp')),
  )
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered)
  if (!isObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])]),
  )
}
