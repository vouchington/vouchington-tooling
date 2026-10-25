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
vi.mock('./commands/mcp.mts', () => ({
  runMcpCommand: vi.fn(async () => 0),
}))
vi.mock('./commands/hook.mts', () => ({
  runHookCommand: vi.fn(async () => 0),
}))
vi.mock('./commands/sandbox-command-audit.mts', () => ({
  runSandboxCommandAuditCommand: vi.fn(async () => 0),
}))
vi.mock('./commands/cloc.mts', () => ({
  runClocCommand: vi.fn(async () => 0),
}))
vi.mock('./commands/coverage-scope-check.mts', () => ({
  runCoverageScopeCheckCommand: vi.fn(() => 0),
}))
vi.mock('./commands/storybook-browser-runner.mts', () => ({
  runStorybookBrowserRunnerCommand: vi.fn(async () => 0),
}))
vi.mock('./commands/worktree.mts', () => ({
  runWorktreeCommand: vi.fn(() => 0),
}))

import { runCli } from './index.mts'
import { runWorktreeCommand } from './commands/worktree.mts'
import { runPnpmInstallCli } from './commands/pnpm-install.mts'
import { runVitestBlobManifestCommand } from './commands/vitest-blob-manifest.mts'
import { runVitestReportAttemptCommand } from './commands/vitest-report-attempt.mts'
import { runPrepareVitestReportsCommand } from './commands/prepare-vitest-reports.mts'
import { runRetrospectiveFactsCommand } from './commands/retrospective-facts.mts'
import { runAgentBlackboardCommand } from './commands/agent-blackboard.mts'
import { runMcpCommand } from './commands/mcp.mts'
import { runHookCommand } from './commands/hook.mts'
import { runSandboxCommandAuditCommand } from './commands/sandbox-command-audit.mts'
import { runClocCommand } from './commands/cloc.mts'
import { runCoverageScopeCheckCommand } from './commands/coverage-scope-check.mts'
import { runStorybookBrowserRunnerCommand } from './commands/storybook-browser-runner.mts'

describe('runCli extract command dispatch', () => {
  afterEach(() => {
    vi.mocked(runPnpmInstallCli).mockClear()
    vi.mocked(runVitestBlobManifestCommand).mockClear()
    vi.mocked(runVitestReportAttemptCommand).mockClear()
    vi.mocked(runPrepareVitestReportsCommand).mockClear()
    vi.mocked(runRetrospectiveFactsCommand).mockClear()
    vi.mocked(runAgentBlackboardCommand).mockClear()
    vi.mocked(runMcpCommand).mockClear()
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

  it('forwards the hook subcommand and its arguments', async () => {
    await expect(runCli(['node', 'vouchington', 'hook', 'post-tool-use'])).resolves.toBe(0)
    expect(runHookCommand).toHaveBeenCalledWith(['post-tool-use'])
  })

  it('forwards the sandbox-command-audit subcommand and its arguments', async () => {
    await expect(
      runCli(['node', 'vouchington', 'sandbox-command-audit', '--rules', 'r.mjs']),
    ).resolves.toBe(0)
    expect(runSandboxCommandAuditCommand).toHaveBeenCalledWith(['--rules', 'r.mjs'])
  })

  it('forwards the cloc subcommand and its arguments', async () => {
    await expect(runCli(['node', 'vouchington', 'cloc', '--config', 'c.json'])).resolves.toBe(0)
    expect(runClocCommand).toHaveBeenCalledWith(['--config', 'c.json'])
  })

  it('forwards the coverage-scope-check subcommand and its arguments', async () => {
    await expect(
      runCli(['node', 'vouchington', 'coverage-scope-check', '--include', '**/*.ts']),
    ).resolves.toBe(0)
    expect(runCoverageScopeCheckCommand).toHaveBeenCalledWith(['--include', '**/*.ts'])
  })

  it('forwards the storybook-browser-runner subcommand and its arguments', async () => {
    await expect(
      runCli(['node', 'vouchington', 'storybook-browser-runner', '--project', 'p']),
    ).resolves.toBe(0)
    expect(runStorybookBrowserRunnerCommand).toHaveBeenCalledWith(['--project', 'p'])
  })

  it('forwards the mcp subcommand and its arguments', async () => {
    await expect(runCli(['node', 'vouchington', 'mcp'])).resolves.toBe(0)
    expect(runMcpCommand).toHaveBeenCalledWith([])
    await expect(runCli(['node', 'vouchington', 'mcp', 'extra'])).resolves.toBe(0)
    expect(runMcpCommand).toHaveBeenLastCalledWith(['extra'])
  })

  it('forwards the worktree subcommand and its arguments', () => {
    expect(runCli(['node', 'vouchington', 'worktree', 'reclaim', '--yes'])).toBe(0)
    expect(runWorktreeCommand).toHaveBeenCalledWith(['reclaim', '--yes'])
  })
})
