import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./commands/pnpm-install.mts', () => ({
  runPnpmInstallCli: vi.fn(async () => 0),
}))
vi.mock('./commands/vitest-blob-manifest.mts', () => ({
  runVitestBlobManifestCommand: vi.fn(() => 0),
}))
vi.mock('./commands/vitest-report-attempt.mts', () => ({
  runVitestReportAttemptCommand: vi.fn(() => 0),
}))
vi.mock('./commands/prepare-vitest-reports.mts', () => ({
  runPrepareVitestReportsCommand: vi.fn(() => 0),
}))
vi.mock('./commands/retrospective-facts.mts', () => ({
  runRetrospectiveFactsCommand: vi.fn(async () => 0),
}))
vi.mock('./commands/agent-blackboard.mts', () => ({
  runAgentBlackboardCommand: vi.fn(async () => 0),
}))

import { runCli } from './index.mts'
import { runPnpmInstallCli } from './commands/pnpm-install.mts'
import { runVitestBlobManifestCommand } from './commands/vitest-blob-manifest.mts'
import { runVitestReportAttemptCommand } from './commands/vitest-report-attempt.mts'
import { runPrepareVitestReportsCommand } from './commands/prepare-vitest-reports.mts'
import { runRetrospectiveFactsCommand } from './commands/retrospective-facts.mts'
import { runAgentBlackboardCommand } from './commands/agent-blackboard.mts'

describe('runCli extract command dispatch', () => {
  afterEach(() => {
    vi.mocked(runPnpmInstallCli).mockClear()
    vi.mocked(runVitestBlobManifestCommand).mockClear()
    vi.mocked(runVitestReportAttemptCommand).mockClear()
    vi.mocked(runPrepareVitestReportsCommand).mockClear()
    vi.mocked(runRetrospectiveFactsCommand).mockClear()
    vi.mocked(runAgentBlackboardCommand).mockClear()
  })

  it('forwards pnpm-install and vitest-blob-manifest to their commands', async () => {
    await expect(
      runCli([
        'node',
        'vouchington',
        'pnpm-install',
        '--runner-lifecycle',
        'persistent',
        '--install-scripts',
        'true',
      ]),
    ).resolves.toBe(0)
    expect(vi.mocked(runPnpmInstallCli)).toHaveBeenCalledOnce()
    expect(runCli(['node', 'vouchington', 'vitest-blob-manifest', 'tooling'])).toBe(0)
    expect(vi.mocked(runVitestBlobManifestCommand)).toHaveBeenCalledWith(['tooling'])
    expect(runCli(['node', 'vouchington', 'vitest-report-attempt', 'read', 'markers'])).toBe(0)
    expect(runVitestReportAttemptCommand).toHaveBeenCalledWith(['read', 'markers'])
    expect(runCli(['node', 'vouchington', 'prepare-vitest-reports'])).toBe(0)
    expect(runPrepareVitestReportsCommand).toHaveBeenCalledWith([])
  })

  it('forwards retrospective facts and agent-blackboard command arguments', async () => {
    await expect(runCli(['node', 'vouchington', 'retrospective-facts', '--no-pr'])).resolves.toBe(0)
    expect(runRetrospectiveFactsCommand).toHaveBeenCalledWith(['--no-pr'])
    await expect(runCli(['node', 'vouchington', 'agent-blackboard', 'probe'])).resolves.toBe(0)
    expect(runAgentBlackboardCommand).toHaveBeenCalledWith(['probe'])
  })
})
