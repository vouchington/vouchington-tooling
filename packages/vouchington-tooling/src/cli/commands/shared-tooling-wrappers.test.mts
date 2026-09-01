import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../require-up-to-date/index.mts', () => ({
  requireUpToDate: vi.fn(),
}))
vi.mock('../../ast-grep-examples/index.mts', () => ({
  runAstGrepExamples: vi.fn(() => 7),
}))

import { runAstGrepExamples } from '../../ast-grep-examples/index.mts'
import { requireUpToDate } from '../../require-up-to-date/index.mts'
import { runAstGrepExamplesCommand } from './ast-grep-examples.mts'
import { runGhaWorkspacePolicy } from './gha-workspace-policy.mts'
import { runRequireUpToDate } from './require-up-to-date.mts'

describe('shared tooling command wrappers', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    stderr.mockClear()
    vi.mocked(requireUpToDate).mockReset()
    vi.mocked(runAstGrepExamples).mockReset()
    vi.mocked(runAstGrepExamples).mockReturnValue(7)
  })

  it('maps require-up-to-date outcomes to CLI exit codes', () => {
    expect(runRequireUpToDate({ remote: 'origin', branch: 'main' })).toBe(0)
    expect(requireUpToDate).toHaveBeenCalledWith({ remote: 'origin', branch: 'main' })
    vi.mocked(requireUpToDate).mockImplementationOnce(() => {
      throw new Error('not current')
    })
    expect(runRequireUpToDate({ remote: 'origin', branch: 'main' })).toBe(1)
    expect(stderr).toHaveBeenCalledWith('not current\n')
  })

  it('passes ast-grep options and its result through unchanged', () => {
    expect(runAstGrepExamplesCommand({ rules: 'rules', config: 'sgconfig.yml' })).toBe(7)
    expect(runAstGrepExamples).toHaveBeenCalledWith({ rules: 'rules', config: 'sgconfig.yml' })
  })

  it('uses the current directory and empty policy options by default', async () => {
    const buildContext = vi.fn(async () => ({}) as never)
    const check = vi.fn(async () => ({ errors: [] }))
    await expect(runGhaWorkspacePolicy({}, { buildContext, check })).resolves.toBe(0)
    expect(buildContext).toHaveBeenCalledWith(process.cwd())
    expect(check).toHaveBeenCalledWith({}, {})
  })
})
