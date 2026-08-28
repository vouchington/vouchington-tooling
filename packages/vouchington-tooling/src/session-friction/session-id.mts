import { createHash } from 'node:crypto'

import { isWellFormedUnicode, normalizeAuditText } from './text.mts'

const SESSION_ID_MAX_LENGTH = 4096

export function validateSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string') throw new Error('sessionId must be a string')
  if (sessionId.length > SESSION_ID_MAX_LENGTH) throw new Error('sessionId is too long')
  if (!isWellFormedUnicode(sessionId)) throw new Error('sessionId must be well-formed Unicode')
  if (normalizeAuditText(sessionId) === '') throw new Error('sessionId must be non-empty')
}

export function sanitizeSessionId(sessionId: string): string {
  validateSessionId(sessionId)
  return createHash('sha256').update(sessionId).digest('hex')
}
