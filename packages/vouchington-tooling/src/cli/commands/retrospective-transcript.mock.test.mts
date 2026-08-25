import { afterEach, describe, expect, it, vi } from 'vitest'

import { runRetrospectiveTranscriptCommand } from './retrospective-transcript.mts'

vi.mock('node:util', () => ({
  parseArgs: vi.fn(() => {
    throw 'non-error failure'
  }),
}))

describe('runRetrospectiveTranscriptCommand failures', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => stderr.mockClear())

  it('formats non-Error parser failures', async () => {
    await expect(runRetrospectiveTranscriptCommand([])).resolves.toBe(2)
    expect(stderr).toHaveBeenCalledWith('non-error failure\n')
  })
})
