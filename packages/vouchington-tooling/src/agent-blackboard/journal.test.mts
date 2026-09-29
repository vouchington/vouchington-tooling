import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./feedback-delivery.mts', () => ({
  writeFeedback: vi.fn(async () => ({ status: 'delivered' })),
}))

import { writeFeedback } from './feedback-delivery.mts'
import { appendJournalMarkdown, checkJournalInput } from './journal.mts'
import type { JournalInput } from './journal.mts'

const input: JournalInput = {
  mode: 'autonomous',
  sessionId: 'native:owner',
  parentSessionId: null,
  agent: 'codex',
  version: '1',
  repositories: ['vouchington/vouchington-tooling', 'vouchington/vouchington-tooling'],
  sourceEventId: 'event-1',
  workOutcome: 'unknown',
  feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
}

afterEach(() => vi.mocked(writeFeedback).mockClear())

describe('checkJournalInput', () => {
  it('normalizes repositories and keeps an explicit timestamp', () => {
    const checked = checkJournalInput({ ...input, timestamp: '2026-01-02T03:04:05.000Z' })
    expect(checked.repositories).toEqual(['vouchington/vouchington-tooling'])
    expect(checked.timestamp.toISOString()).toBe('2026-01-02T03:04:05.000Z')
    expect(Number.isNaN(checkJournalInput(input).timestamp.valueOf())).toBe(false)
  })

  it('rejects unsafe ids, unsafe parents, and invalid timestamps', () => {
    expect(() => checkJournalInput({ ...input, sessionId: '../x' })).toThrow('URL-safe')
    expect(() => checkJournalInput({ ...input, parentSessionId: 'a/b' })).toThrow('URL-safe')
    expect(() => checkJournalInput({ ...input, timestamp: 'yesterday' })).toThrow(
      'journal timestamp is not a valid date-time',
    )
  })
})

describe('appendJournalMarkdown', () => {
  it('builds a journal envelope from in-memory markdown and delegates delivery', async () => {
    await appendJournalMarkdown({
      ...input,
      markdown: 'The cache was cold.',
      timestamp: '2026-01-02T03:04:05.000Z',
      category: 'workflow',
      outboxDirectory: '/outbox',
      env: { A: 'b' },
      timeoutMs: 5,
    })
    const call = vi.mocked(writeFeedback).mock.calls[0]?.[0]
    expect(call).toMatchObject({
      mode: 'autonomous',
      outboxDirectory: '/outbox',
      env: { A: 'b' },
      timeoutMs: 5,
      identity: { sessionId: 'native:owner', parentSessionId: null, agent: 'codex', version: '1' },
      envelope: {
        type: 'journal',
        sourceEventId: 'event-1',
        timestamp: '2026-01-02T03:04:05.000Z',
        repositories: ['vouchington/vouchington-tooling'],
        markdown: 'The cache was cold.',
        category: 'workflow',
      },
    })
  })

  it('omits optional delivery settings that were not supplied', async () => {
    await appendJournalMarkdown({ ...input, markdown: 'Note.' })
    const call = vi.mocked(writeFeedback).mock.calls[0]?.[0]
    expect(call).not.toHaveProperty('outboxDirectory')
    expect(call).not.toHaveProperty('env')
    expect(call).not.toHaveProperty('timeoutMs')
    expect(call?.envelope).not.toHaveProperty('category')
  })

  it('validates before any delivery is attempted', async () => {
    await expect(
      appendJournalMarkdown({ ...input, markdown: 'x', sessionId: 'a b' }),
    ).rejects.toThrow('URL-safe')
    expect(writeFeedback).not.toHaveBeenCalled()
  })
})
