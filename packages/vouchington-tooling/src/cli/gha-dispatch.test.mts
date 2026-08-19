import { describe, expect, it, vi } from 'vitest'

vi.mock('./commands/gha-runtime-audit.mts', () => ({
  runGhaRuntimeAudit: vi.fn(async () => 0),
}))

import { runCli } from './index.mts'
import { runGhaRuntimeAudit } from './commands/gha-runtime-audit.mts'

describe('runCli gha-runtime-audit dispatch', () => {
  it('forwards the parsed command to runGhaRuntimeAudit', async () => {
    await expect(
      runCli(['node', 'vouchington', 'gha-runtime-audit', '--pr-workflow', 'CI']),
    ).resolves.toBe(0)
    expect(vi.mocked(runGhaRuntimeAudit)).toHaveBeenCalledOnce()
  })
})
