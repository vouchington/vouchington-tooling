import { describe, expect, it, vi } from 'vitest'

vi.mock('./commands/agent-issue-labels.mts', () => ({
  runAgentIssueLabels: vi.fn(async () => 0),
}))

import { runAgentIssueLabels } from './commands/agent-issue-labels.mts'
import { runCli } from './index.mts'

describe('runCli agent-issue-labels dispatch', () => {
  it('forwards the parsed command to runAgentIssueLabels', async () => {
    await expect(
      runCli(['node', 'vouchington', 'agent-issue-labels', 'ensure-labels', 'bug']),
    ).resolves.toBe(0)
    expect(vi.mocked(runAgentIssueLabels)).toHaveBeenCalledWith({
      kind: 'agent-issue-labels',
      subcommand: 'ensure-labels',
      update: false,
      labels: ['bug'],
    })
  })
})
