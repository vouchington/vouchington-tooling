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
