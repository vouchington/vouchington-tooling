import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./commands/require-up-to-date.mts', () => ({
  runRequireUpToDate: vi.fn(() => 11),
}))
vi.mock('./commands/ast-grep-examples.mts', () => ({
  runAstGrepExamplesCommand: vi.fn(() => 12),
}))
vi.mock('./commands/gha-workspace-policy.mts', () => ({
  runGhaWorkspacePolicy: vi.fn(async () => 13),
}))
vi.mock('./commands/spawn-script.mts', () => ({
  runScript: vi.fn(() => 14),
}))

import { runCli } from './index.mts'
import { runAstGrepExamplesCommand } from './commands/ast-grep-examples.mts'
import { runGhaWorkspacePolicy } from './commands/gha-workspace-policy.mts'
import { runRequireUpToDate } from './commands/require-up-to-date.mts'
import { runScript } from './commands/spawn-script.mts'

describe('runCli shared tooling dispatch', () => {
  afterEach(() => {
    vi.mocked(runRequireUpToDate).mockClear()
    vi.mocked(runAstGrepExamplesCommand).mockClear()
    vi.mocked(runGhaWorkspacePolicy).mockClear()
    vi.mocked(runScript).mockClear()
  })

  it('forwards every shared tooling command to its command boundary', async () => {
    expect(
      runCli([
        'node',
        'vouchington',
        'require-up-to-date',
        '--remote',
        'origin',
        '--branch',
        'main',
      ]),
    ).toBe(11)
    expect(runRequireUpToDate).toHaveBeenCalledWith({
      kind: 'require-up-to-date',
      remote: 'origin',
      branch: 'main',
    })

    expect(
      runCli([
        'node',
        'vouchington',
        'gitleaks-directory-scan',
        '--config',
        'gitleaks.toml',
        '--directory',
        'staged',
      ]),
    ).toBe(14)
    expect(runScript).toHaveBeenCalledWith(
      'bash',
      expect.stringMatching(/gitleaks-directory-scan\.sh$/u),
      ['--config', 'gitleaks.toml', '--root', 'staged'],
    )
    expect(
      runCli(['node', 'vouchington', 'gitleaks-directory-scan', '--config', 'gitleaks.toml']),
    ).toBe(14)
    expect(runScript).toHaveBeenCalledWith(
      'bash',
      expect.stringMatching(/gitleaks-directory-scan\.sh$/u),
      ['--config', 'gitleaks.toml'],
    )

    expect(
      runCli([
        'node',
        'vouchington',
        'ast-grep-examples',
        '--rules',
        'rules',
        '--config',
        'sgconfig.yml',
      ]),
    ).toBe(12)
    expect(runAstGrepExamplesCommand).toHaveBeenCalledWith({
      kind: 'ast-grep-examples',
      rules: 'rules',
      config: 'sgconfig.yml',
    })

    await expect(runCli(['node', 'vouchington', 'gha-workspace-policy'])).resolves.toBe(13)
    expect(runGhaWorkspacePolicy).toHaveBeenCalledWith({ kind: 'gha-workspace-policy' })
  })
})
