import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../agent-blackboard/index.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent-blackboard/index.mts')>()
  return {
    ...actual,
    appendJournal: vi.fn(),
    feedbackOutboxCounts: vi.fn(actual.feedbackOutboxCounts),
    flushFeedbackOutbox: vi.fn(),
    probeBlackboard: vi.fn(),
  }
})
vi.mock('../../agent-blackboard/snapshot.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent-blackboard/snapshot.mts')>()
  return {
    ...actual,
    cleanupSnapshotPartitions: vi.fn(),
    partitionSnapshot: vi.fn(),
  }
})

import { runAgentBlackboardCommand, setJournalReaderForTest } from './agent-blackboard.mts'
import {
  appendJournal,
  feedbackOutboxCounts,
  flushFeedbackOutbox,
  probeBlackboard,
} from '../../agent-blackboard/index.mts'
import { cleanupSnapshotPartitions, partitionSnapshot } from '../../agent-blackboard/snapshot.mts'

describe('agent-blackboard CLI', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  afterEach(() => {
    stderr.mockClear()
    stdout.mockClear()
    vi.mocked(appendJournal).mockReset()
    vi.mocked(flushFeedbackOutbox).mockReset()
    vi.mocked(probeBlackboard).mockReset()
    vi.mocked(cleanupSnapshotPartitions).mockReset()
    vi.mocked(partitionSnapshot).mockReset()
    setJournalReaderForTest()
  })

  it('exposes replay without regenerating pending event content', async () => {
    vi.mocked(flushFeedbackOutbox).mockResolvedValue({
      status: 'empty',
      pendingCount: 0,
      deliveredCount: 1,
    })
    expect(
      await runAgentBlackboardCommand([
        'journal',
        'flush',
        '--outbox-directory',
        '/private/outbox',
      ]),
    ).toBe(0)
    expect(flushFeedbackOutbox).toHaveBeenCalledWith({
      directory: '/private/outbox',
      dependencies: { resolveFrom: expect.any(String) },
    })
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('"deliveredCount":1')
    expect(await runAgentBlackboardCommand(['journal', 'flush'])).toBe(2)
    expect(await runAgentBlackboardCommand(['journal', 'flush', '--mode', 'autonomous'])).toBe(2)
  })

  it('reports per-session status and validates session-aware flush before delivery', async () => {
    vi.mocked(feedbackOutboxCounts).mockReturnValueOnce({
      pendingCount: 0,
      worktreePendingCount: 2,
    })
    expect(
      await runAgentBlackboardCommand([
        'journal',
        'status',
        '--session-id',
        'owner',
        '--outbox-directory',
        '/private/outbox',
      ]),
    ).toBe(0)
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      sessionId: 'owner',
      status: 'empty',
      pendingCount: 0,
      worktreePendingCount: 2,
    })
    for (const sessionId of ['bad/id', '', 'x'.repeat(257)]) {
      expect(
        await runAgentBlackboardCommand([
          'journal',
          'flush',
          '--session-id',
          sessionId,
          '--outbox-directory',
          '/private/outbox',
        ]),
      ).toBe(2)
    }
    expect(flushFeedbackOutbox).not.toHaveBeenCalled()
    expect(
      await runAgentBlackboardCommand([
        'journal',
        'status',
        '--outbox-directory',
        '/private/outbox',
      ]),
    ).toBe(2)
    vi.mocked(feedbackOutboxCounts).mockReturnValueOnce({
      pendingCount: 1,
      worktreePendingCount: 2,
    })
    vi.mocked(flushFeedbackOutbox).mockResolvedValue({
      status: 'pending',
      pendingCount: 2,
      deliveredCount: 0,
    })
    expect(
      await runAgentBlackboardCommand([
        'journal',
        'flush',
        '--session-id',
        'owner',
        '--outbox-directory',
        '/private/outbox',
      ]),
    ).toBe(0)
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      sessionId: 'owner',
      status: 'pending',
      pendingCount: 1,
      worktreePendingCount: 2,
      deliveredCount: 0,
    })
  })

  it('rejects malformed commands before loading the optional integration dependency', async () => {
    await expect(runAgentBlackboardCommand(['journal', 'entries'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--session-id is required')
  })

  it('rejects malformed append identities before network access', async () => {
    await expect(
      runAgentBlackboardCommand(['journal', 'append', '--session-id', 'bad']),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--mode is required')
    await expect(
      runAgentBlackboardCommand([
        'journal',
        'append',
        '--mode',
        'autonomous',
        '--source-event-id',
        'cli:note',
        '--work-outcome',
        'unknown',
        '--coverage-status',
        'not-assessed',
        '--session-id',
        'one',
        '--agent',
        'codex',
        '--file',
        'entry.md',
      ]),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--repository is required')
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
    setJournalReaderForTest(async () => Promise.reject({ statusCode: 404 }))
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
    setJournalReaderForTest(async () => Promise.reject('provider unavailable'))
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

  it('reports incomplete options and unknown journal and snapshot actions', async () => {
    await expect(runAgentBlackboardCommand(['journal', 'entries', 'session'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('invalid option: session')
    await expect(runAgentBlackboardCommand(['journal', 'other'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('journal append|entries')
    await expect(runAgentBlackboardCommand(['snapshot', 'other'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('snapshot partition|cleanup')
    await expect(
      runAgentBlackboardCommand(['journal', 'entries', undefined as never]),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('invalid option: ')
    for (const flags of [['session'], ['--repository'], [undefined as never]]) {
      await expect(runAgentBlackboardCommand(['journal', 'append', ...flags])).resolves.toBe(2)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('invalid option:')
    }
  })

  it('runs the probe and journal append commands through their service boundaries', async () => {
    vi.mocked(appendJournal).mockResolvedValue({
      status: 'delivered',
      sourceEventId: 'cli:note',
      pendingCount: 0,
      receipt: {
        sessionId: 'session',
        sourceEventId: 'cli:note',
        createdAt: '2026-01-01T00:00:00.000Z',
        timestamp: '2026-01-01T00:00:00.000Z',
        verified: true,
      },
    })
    vi.mocked(feedbackOutboxCounts).mockClear()
    await expect(runAgentBlackboardCommand(['probe'])).resolves.toBe(0)
    expect(probeBlackboard).toHaveBeenCalledOnce()
    await expect(
      runAgentBlackboardCommand([
        'journal',
        'append',
        '--mode',
        'autonomous',
        '--source-event-id',
        'cli:note',
        '--work-outcome',
        'unknown',
        '--coverage-status',
        'not-assessed',
        '--session-id',
        'session',
        '--agent',
        'codex',
        '--file',
        'entry.md',
        '--version',
        '1.0.0',
        '--parent-session-id',
        'parent',
        '--timestamp',
        '2026-01-01T00:00:00.000Z',
        '--repository',
        'vouchington/vouchington',
        '--repository',
        'jonathanong/agent-blackboard',
      ]),
    ).resolves.toBe(0)
    expect(appendJournal).toHaveBeenCalledWith({
      dependencies: { resolveFrom: expect.any(String) },
      mode: 'autonomous',
      sourceEventId: 'cli:note',
      workOutcome: 'unknown',
      feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
      sessionId: 'session',
      agent: 'codex',
      version: '1.0.0',
      markdownFile: 'entry.md',
      repositories: ['vouchington/vouchington', 'jonathanong/agent-blackboard'],
      parentSessionId: 'parent',
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'delivered',
      sourceEventId: 'cli:note',
      pendingCount: 0,
      worktreePendingCount: 0,
    })
    expect(feedbackOutboxCounts).not.toHaveBeenCalled()
    await expect(
      runAgentBlackboardCommand([
        'journal',
        'append',
        '--mode',
        'autonomous',
        '--source-event-id',
        'cli:note',
        '--work-outcome',
        'unknown',
        '--coverage-status',
        'not-assessed',
        '--session-id',
        'session',
        '--agent',
        'codex',
        '--file',
        'entry.md',
        '--repository',
        'vouchington/vouchington',
      ]),
    ).resolves.toBe(0)
    expect(appendJournal).toHaveBeenLastCalledWith({
      dependencies: { resolveFrom: expect.any(String) },
      mode: 'autonomous',
      sourceEventId: 'cli:note',
      workOutcome: 'unknown',
      feedbackCoverage: { status: 'not-assessed', sources: [], droppedCount: 0 },
      parentSessionId: null,
      sessionId: 'session',
      agent: 'codex',
      version: 'unknown',
      markdownFile: 'entry.md',
      repositories: ['vouchington/vouchington'],
    })
  })

  it('runs snapshot partition and cleanup commands through their service boundaries', async () => {
    const receipt = { nonce: 'receipt' }
    vi.mocked(partitionSnapshot).mockResolvedValue({ partitions: [] } as never)
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'partition',
        '--snapshot',
        'snapshot.json',
        '--checksum',
        'checksum',
        '--counts',
        '{"entries":1}',
      ]),
    ).resolves.toBe(0)
    expect(partitionSnapshot).toHaveBeenCalledWith({
      path: 'snapshot.json',
      checksum: { algorithm: 'sha256', value: 'checksum' },
      counts: { entries: 1 },
    })
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'cleanup',
        '--snapshot',
        'snapshot.json',
        '--partition-directory',
        'partitions',
        '--receipt',
        JSON.stringify(receipt),
      ]),
    ).resolves.toBe(0)
    expect(cleanupSnapshotPartitions).toHaveBeenCalledWith({
      path: 'snapshot.json',
      directory: 'partitions',
      receipt,
    })
    await expect(
      runAgentBlackboardCommand(['snapshot', 'cleanup', '--snapshot', 'snapshot.json']),
    ).resolves.toBe(0)
    expect(cleanupSnapshotPartitions).toHaveBeenLastCalledWith({ path: 'snapshot.json' })
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'cleanup',
        '--partition-directory',
        'partitions',
        '--receipt',
        JSON.stringify(receipt),
      ]),
    ).resolves.toBe(0)
    expect(cleanupSnapshotPartitions).toHaveBeenLastCalledWith({
      directory: 'partitions',
      receipt,
    })
    expect(String(stdout.mock.calls.at(-1)?.[0])).toBe('{"cleaned":true}\n')
  })
})

it('reports interactive session and worktree counts without failing primary work', async () => {
  vi.mocked(feedbackOutboxCounts).mockReturnValueOnce({ pendingCount: 1, worktreePendingCount: 2 })
  vi.mocked(appendJournal).mockResolvedValue({
    status: 'pending',
    sourceEventId: 'cli:pending',
    timestamp: '2026-01-01T00:00:00.000Z',
    pendingCount: 2,
    diagnostic: 'configuration-invalid',
  })
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    await expect(
      runAgentBlackboardCommand([
        'journal',
        'append',
        '--mode',
        'interactive',
        '--source-event-id',
        'cli:pending',
        '--work-outcome',
        'unknown',
        '--coverage-status',
        'not-assessed',
        '--session-id',
        'native:owner',
        '--agent',
        'codex',
        '--file',
        'entry.md',
        '--repository',
        'owner/repo',
        '--outbox-directory',
        '/private/tmp/outbox',
        '--coverage-source',
        'tool-result',
        '--dropped-count',
        '2',
      ]),
    ).resolves.toBe(0)
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'pending',
      pendingCount: 1,
      worktreePendingCount: 2,
    })
  } finally {
    stdout.mockRestore()
  }
})
