import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgentBlackboardCommand, setJournalReaderForTest } from './agent-blackboard.mts'

describe('agent-blackboard CLI', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  afterEach(() => {
    stderr.mockClear()
    stdout.mockClear()
    setJournalReaderForTest()
  })

  it('rejects malformed commands before loading the optional peer', async () => {
    await expect(runAgentBlackboardCommand(['journal', 'entries'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--session-id is required')
  })

  it('rejects malformed append identities before network access', async () => {
    await expect(
      runAgentBlackboardCommand(['journal', 'append', '--session-id', 'bad']),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--agent is required')
  })

  it('rejects unknown and duplicate flags while allowing values that begin with dashes', async () => {
    await expect(
      runAgentBlackboardCommand(['snapshot', 'cleanup', '--unexpected', 'value']),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('unknown option')
    await expect(
      runAgentBlackboardCommand([
        'journal',
        'entries',
        '--session-id',
        'one',
        '--session-id',
        'two',
      ]),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('duplicate option')
  })

  it('filters and chronologically formats journal entries', async () => {
    setJournalReaderForTest(async () => [
      { createdAt: '2026-01-02T00:00:00.000Z', data: { type: 'journal', markdown: 'second' } },
      { createdAt: '2026-01-01T00:00:00.000Z', data: { type: 'other', markdown: 'skip' } },
      { createdAt: '2026-01-01T00:00:00.000Z', data: { type: 'journal', markdown: 'first' } },
    ])
    await expect(
      runAgentBlackboardCommand(['journal', 'entries', '--session-id', 'one']),
    ).resolves.toBe(0)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toBe(
      '## 2026-01-01T00:00:00.000Z\n\nfirst\n\n## 2026-01-02T00:00:00.000Z\n\nsecond\n',
    )
  })

  it('formats empty and 404 journal reads as no entries but propagates other provider errors', async () => {
    setJournalReaderForTest(async () => [])
    await expect(
      runAgentBlackboardCommand(['journal', 'entries', '--session-id', 'one']),
    ).resolves.toBe(0)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toBe(
      'No journal entries found for session one.\n',
    )
    setJournalReaderForTest(async () => Promise.reject({ status: 404 }))
    await expect(
      runAgentBlackboardCommand(['journal', 'entries', '--session-id', 'one']),
    ).resolves.toBe(0)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toBe(
      'No journal entries found for session one.\n',
    )
    setJournalReaderForTest(async () => Promise.reject(new Error('provider unavailable')))
    await expect(
      runAgentBlackboardCommand(['journal', 'entries', '--session-id', 'one']),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('provider unavailable')
  })

  it('includes snapshot commands in its root usage failure', async () => {
    await expect(runAgentBlackboardCommand([])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('snapshot partition|cleanup')
  })

  it('requires a cleanup receipt for partition directories', async () => {
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'cleanup',
        '--partition-directory',
        '/tmp/partitions',
      ]),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--receipt is required')
  })
})
