const SESSION_ID = /^[A-Za-z0-9._:-]+$/

export function assertSessionId(sessionId: string, label = 'session id'): void {
  if (!SESSION_ID.test(sessionId)) throw new Error(`${label} must be URL-safe`)
}
