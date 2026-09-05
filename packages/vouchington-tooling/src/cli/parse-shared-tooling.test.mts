import { describe, expect, it } from 'vitest'
import { parseCli } from './parse.mts'

describe('shared tooling command parsing', () => {
  it('parses shared tooling commands and their option boundaries', () => {
    expect(parseCli(['node', 'vouchington', 'require-up-to-date', '--help'])).toEqual({
      kind: 'help',
    })
    expect(parseCli(['node', 'vouchington', 'require-up-to-date', '--remote', 'origin'])).toEqual({
      kind: 'error',
      message: '--branch requires a name',
    })
    expect(parseCli(['node', 'vouchington', 'require-up-to-date', '--branch', 'main'])).toEqual({
      kind: 'error',
      message: '--remote requires a name',
    })
    expect(parseCli(['node', 'vouchington', 'require-up-to-date', '--unknown', 'value'])).toEqual({
      kind: 'error',
      message: 'unknown require-up-to-date option: --unknown',
    })
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
    ).toEqual({
      kind: 'gitleaks-directory-scan',
      config: 'gitleaks.toml',
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'gitleaks-directory-scan',
        '--config',
        'gitleaks.toml',
        '--directory',
        'staged',
      ]),
    ).toEqual({ kind: 'gitleaks-directory-scan', config: 'gitleaks.toml', directory: 'staged' })
    expect(
      parseCli(['node', 'vouchington', 'gitleaks-directory-scan', '--directory', 'staged']),
    ).toEqual({
      kind: 'error',
      message: '--config requires a path',
    })
    expect(parseCli(['node', 'vouchington', 'gitleaks-directory-scan', '--unknown'])).toEqual({
      kind: 'error',
      message: 'unknown gitleaks-directory-scan option: --unknown',
    })

    expect(parseCli(['node', 'vouchington', 'ast-grep-examples', '--rules', 'rules'])).toEqual({
      kind: 'error',
      message: '--config requires a path',
    })
    expect(
      parseCli(['node', 'vouchington', 'ast-grep-examples', '--config', 'sgconfig.yml']),
    ).toEqual({
      kind: 'error',
      message: '--rules requires a path',
    })
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
    expect(parseCli(['node', 'vouchington', 'ast-grep-examples', '--unknown'])).toEqual({
      kind: 'error',
      message: 'unknown ast-grep-examples option: --unknown',
    })
    expect(parseCli(['node', 'vouchington', 'ast-grep-pack'])).toEqual({ kind: 'ast-grep-pack' })
    expect(parseCli(['node', 'vouchington', 'ast-grep-pack', '--help'])).toEqual({ kind: 'help' })
    expect(parseCli(['node', 'vouchington', 'ast-grep-pack', '--rules'])).toEqual({
      kind: 'error',
      message: 'unknown ast-grep-pack option: --rules',
    })

    expect(parseCli(['node', 'vouchington', 'gha-workspace-policy'])).toEqual({
      kind: 'gha-workspace-policy',
    })
    expect(
      parseCli([
        'node',
        'vouchington',
        'gha-workspace-policy',
        '--root',
        'repo',
        '--workflow-directory',
        '.github/workflows',
        '--workflow-directory',
        'ci/workflows',
        '--action-directory',
        '.github/actions',
        '--action-directory',
        'ci/actions',
      ]),
    ).toEqual({
      kind: 'gha-workspace-policy',
      root: 'repo',
      workflowDirectories: ['.github/workflows', 'ci/workflows'],
      actionDirectories: ['.github/actions', 'ci/actions'],
    })
    expect(parseCli(['node', 'vouchington', 'gha-workspace-policy', '--unknown'])).toEqual({
      kind: 'error',
      message: 'unknown gha-workspace-policy option: --unknown',
    })
  })
})
