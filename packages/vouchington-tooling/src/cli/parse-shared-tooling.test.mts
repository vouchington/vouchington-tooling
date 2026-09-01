import { describe, expect, it } from 'vitest'

import { parseCli } from './parse.mts'

describe('shared tooling CLI parsing', () => {
  it('parses commands and their required flags', () => {
    expect(
      parseCli([
        'node',
        'vouchington',
        'require-up-to-date',
        '--remote',
        'origin',
        '--branch',
        'main',
      ]),
    ).toEqual({ kind: 'require-up-to-date', remote: 'origin', branch: 'main' })
    expect(
      parseCli(['node', 'vouchington', 'gitleaks-directory-scan', '--config', 'gitleaks.toml']),
    ).toEqual({ kind: 'gitleaks-directory-scan', config: 'gitleaks.toml' })
    expect(
      parseCli([
        'node',
        'vouchington',
        'ast-grep-examples',
        '--rules',
        'rules',
        '--config',
        'sgconfig.yml',
      ]),
    ).toEqual({ kind: 'ast-grep-examples', rules: 'rules', config: 'sgconfig.yml' })
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-workspace-policy',
        '--root',
        'repo',
        '--workflow-directory',
        'ci/workflows',
        '--action-directory',
        'ci/actions',
      ]),
    ).toEqual({
      kind: 'gha-workspace-policy',
      root: 'repo',
      workflowDirectories: ['ci/workflows'],
      actionDirectories: ['ci/actions'],
    })
  })

  it('reports missing required flags', () => {
    expect(parseCli(['node', 'vouchington', 'require-up-to-date', '--remote', 'origin'])).toEqual({
      kind: 'error',
      message: '--branch requires a name',
    })
    expect(parseCli(['node', 'vouchington', 'gitleaks-directory-scan'])).toEqual({
      kind: 'error',
      message: '--config requires a path',
    })
  })
})
