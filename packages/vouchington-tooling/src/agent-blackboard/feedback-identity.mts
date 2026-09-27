import { isWellFormedUnicode } from '../session-friction/text.mts'
import { assertSessionId } from './session-id.mts'
import { isObject } from './snapshot-partition-guards.mts'
import type { FeedbackIdentity } from './feedback-types.mts'
export function validateFeedbackIdentity(identity: unknown): asserts identity is FeedbackIdentity {
  if (!isObject(identity) || typeof identity.sessionId !== 'string')
    throw new Error('explicit feedback identity is required')
  assertSessionId(identity.sessionId)
  if (identity.sessionId.length > 256) throw new Error('session identity is too long')
  if (identity.parentSessionId !== null) {
    if (typeof identity.parentSessionId !== 'string')
      throw new Error('explicit parent identity is required')
    assertSessionId(identity.parentSessionId, 'parent session id')
    if (identity.parentSessionId.length > 256)
      throw new Error('parent session identity is too long')
  }
  if (identity.parentSessionId === identity.sessionId)
    throw new Error('a session cannot parent itself')
  for (const key of ['agent', 'version'])
    if (
      typeof identity[key] !== 'string' ||
      !identity[key].trim() ||
      identity[key].length > 128 ||
      !isWellFormedUnicode(identity[key]) ||
      // oxlint-disable-next-line no-control-regex -- reject control characters at the durable boundary
      /[\x00-\x1f\x7f]/.test(identity[key])
    )
      throw new Error(`explicit ${key} is required`)
  if (
    Object.keys(identity).some(
      (key) => !['sessionId', 'parentSessionId', 'agent', 'version'].includes(key),
    )
  )
    throw new Error('unsupported identity field')
}
