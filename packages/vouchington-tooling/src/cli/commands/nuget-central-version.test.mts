import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../nuget-central-version/cli.mts', () => ({
  runNugetCentralVersionCli: vi.fn(),
}))

import { runNugetCentralVersionCli } from '../../nuget-central-version/cli.mts'
import { runNugetCentralVersionCommand } from './nuget-central-version.mts'

describe('runNugetCentralVersionCommand', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stderr.mockClear()
    vi.mocked(runNugetCentralVersionCli).mockReset()
  })

  it('returns 1 for a non-error throw', () => {
    vi.mocked(runNugetCentralVersionCli).mockImplementation(() => {
      throw 'nope'
    })
    expect(runNugetCentralVersionCommand(['a', 'b', 'c', 'd'])).toBe(1)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('nope')
  })
})
