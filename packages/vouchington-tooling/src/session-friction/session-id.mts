import { createHash } from 'node:crypto'

import { normalizeAuditText } from './text.mts'

const SESSION_ID_MAX_LENGTH = 4096
const ILL_FORMED_UTF16 = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

export function validateSessionId(sessionId: string): void {
  if (ILL_FORMED_UTF16.test(sessionId)) throw new Error('sessionId must be well-formed Unicode')
  if (normalizeAuditText(sessionId) === '') throw new Error('sessionId must be non-empty')
  if (sessionId.length > SESSION_ID_MAX_LENGTH) throw new Error('sessionId is too long')
}

export function sanitizeSessionId(sessionId: string): string {
  validateSessionId(sessionId)
  return createHash('sha256').update(sessionId).digest('hex')
}
