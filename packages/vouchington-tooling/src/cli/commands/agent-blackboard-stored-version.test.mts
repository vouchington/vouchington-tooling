import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../agent-blackboard/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent-blackboard/index.mts')>()),
  appendJournal: vi.fn(),
}))

import { runAgentBlackboardCommand } from './agent-blackboard.mts'
import { appendJournal } from '../../agent-blackboard/index.mts'

describe('agent-blackboard CLI journal append', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  afterEach(() => {
    stdout.mockClear()
    vi.mocked(appendJournal).mockReset()
  })

  it('reports the stored version when a version-only mismatch is delivered', async () => {
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
        storedVersion: 'unknown',
      },
    })
    const args = ['--mode', 'autonomous', '--source-event-id', 'e', '--work-outcome', 'unknown']
    args.push('--coverage-status', 'not-assessed', '--session-id', 'session', '--agent', 'codex')
    args.push('--file', 'entry.md', '--repository', 'vouchington/vouchington', '--version', '2')
    await expect(runAgentBlackboardCommand(['journal', 'append', ...args])).resolves.toBe(0)
    expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'delivered',
      storedVersion: 'unknown',
    })
  })
})
