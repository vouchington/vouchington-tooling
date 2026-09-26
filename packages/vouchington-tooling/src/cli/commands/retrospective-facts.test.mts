import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../retrospective-facts/index.mts', () => ({
  runRetrospectiveFacts: vi.fn(),
}))

import { runRetrospectiveFacts } from '../../retrospective-facts/index.mts'
import { runRetrospectiveFactsCommand } from './retrospective-facts.mts'

describe('retrospective-facts CLI', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stdout.mockClear()
    stderr.mockClear()
    vi.mocked(runRetrospectiveFacts).mockReset()
  })

  it('forwards supported options and warnings to the retrospective service', async () => {
    vi.mocked(runRetrospectiveFacts).mockImplementation(async ({ onWarning }) => {
      onWarning?.('git metadata unavailable')
      return '{"facts":true}\n'
    })
    await expect(
      runRetrospectiveFactsCommand(['--pr', '42', '--repo', 'owner/repo', '--raw']),
    ).resolves.toBe(0)
    expect(runRetrospectiveFacts).toHaveBeenCalledWith({
      pr: '42',
      repo: 'owner/repo',
      raw: true,
      onWarning: expect.any(Function),
    })
    expect(String(stdout.mock.calls.at(-1)?.[0])).toBe('{"facts":true}\n')
    expect(String(stderr.mock.calls.at(-1)?.[0])).toBe('git metadata unavailable\n')
  })

  it('prints one fact block per --pr and writes nothing when a later PR fails', async () => {
    vi.mocked(runRetrospectiveFacts)
      .mockResolvedValueOnce('=== Retrospective Facts ===\nPR: 541')
      .mockResolvedValueOnce('=== Retrospective Facts ===\nPR: 542\n')
    await expect(
      runRetrospectiveFactsCommand(['--pr', '541', '--pr', '542', '--repo', 'owner/repo', '--raw']),
    ).resolves.toBe(0)
    expect(runRetrospectiveFacts).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pr: '541', repo: 'owner/repo', raw: true }),
    )
    expect(runRetrospectiveFacts).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pr: '542', repo: 'owner/repo', raw: true }),
    )
    expect(String(stdout.mock.calls.at(-1)?.[0])).toBe(
      '=== Retrospective Facts ===\nPR: 541\n\n=== Retrospective Facts ===\nPR: 542\n',
    )
    stdout.mockClear()
    vi.mocked(runRetrospectiveFacts).mockReset()
    vi.mocked(runRetrospectiveFacts)
      .mockResolvedValueOnce('first\n')
      .mockRejectedValueOnce(new Error('git failed'))
    await expect(runRetrospectiveFactsCommand(['--pr', '1', '--pr', 'nope'])).resolves.toBe(2)
    expect(stdout).not.toHaveBeenCalled()
    expect(String(stderr.mock.calls.at(-1)?.[0])).toBe('git failed\n')
  })

  it('reports parser and service errors without writing facts', async () => {
    await expect(runRetrospectiveFactsCommand(['--unknown'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('Unknown option')
    vi.mocked(runRetrospectiveFacts).mockRejectedValue(new Error('git failed'))
    await expect(runRetrospectiveFactsCommand(['--no-pr'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toBe('git failed\n')
    vi.mocked(runRetrospectiveFacts).mockRejectedValue('raw failure')
    await expect(runRetrospectiveFactsCommand(['--branch', 'topic'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toBe('raw failure\n')
    expect(stdout).not.toHaveBeenCalled()
  })
})
