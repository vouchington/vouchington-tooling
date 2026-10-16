import type { Session, SessionEntry } from './session-types.mts'

export function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    parentSessionId: null,
    agent: 'claude',
    version: '1',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastEntryAt: null,
    archivedAt: null,
    data: {},
    ...overrides,
  }
}

export function entryFixture(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: 'session-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    data: {},
    ...overrides,
  }
}
