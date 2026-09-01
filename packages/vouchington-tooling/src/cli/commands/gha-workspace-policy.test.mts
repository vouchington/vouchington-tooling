import { describe, expect, it, vi } from 'vitest'

import { runGhaWorkspacePolicy } from './gha-workspace-policy.mts'

describe('gha-workspace-policy CLI', () => {
  it('prints each policy error and fails the command', async () => {
    const stderr = { write: vi.fn() }
    await expect(
      runGhaWorkspacePolicy(
        { root: '/repo' },
        {
          buildContext: async () => ({}) as never,
          check: async () => ({ errors: ['first error', 'second error'] }),
          stderr: stderr as never,
        },
      ),
    ).resolves.toBe(1)
    expect(stderr.write).toHaveBeenCalledWith('first error\nsecond error\n')
  })

  it('passes root and configured directories to the policy library', async () => {
    const check = vi.fn(async () => ({ errors: [] }))
    await expect(
      runGhaWorkspacePolicy(
        {
          root: '/repo',
          workflowDirectories: ['ci/workflows'],
          actionDirectories: ['ci/actions'],
        },
        { buildContext: async () => ({}) as never, check },
      ),
    ).resolves.toBe(0)
    expect(check).toHaveBeenCalledWith(
      {},
      { workflowDirectories: ['ci/workflows'], actionDirectories: ['ci/actions'] },
    )
  })

  it('uses the production context and policy implementations by default', async () => {
    await expect(runGhaWorkspacePolicy({ root: process.cwd() })).resolves.toBe(0)
  })

  it('writes policy failures to process stderr by default', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(
      runGhaWorkspacePolicy(
        { root: '/repo' },
        {
          buildContext: async () => ({}) as never,
          check: async () => ({ errors: ['policy failure'] }),
        },
      ),
    ).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith('policy failure\n')
    stderr.mockRestore()
  })
})
