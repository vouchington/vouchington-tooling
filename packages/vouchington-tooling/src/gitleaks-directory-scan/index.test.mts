import { describe, expect, it } from 'vitest'

import { gitleaksDirectoryScanArguments, runGitleaksDirectoryScan } from './index.mts'

describe('gitleaks-directory-scan', () => {
  it('runs a directory scan with an explicit config and default directory', async () => {
    const calls: Array<[string, string[]]> = []
    await expect(
      runGitleaksDirectoryScan({
        config: '.gitleaks.toml',
        execute: async (executable, args) => {
          calls.push([executable, [...args]])
          return 0
        },
      }),
    ).resolves.toBe(0)
    expect(calls).toEqual([
      [
        'bash',
        [expect.stringMatching(/gitleaks-directory-scan\.sh$/), '--config', '.gitleaks.toml'],
      ],
    ])
  })

  it('supports a caller-selected executable and directory', async () => {
    expect(gitleaksDirectoryScanArguments({ config: 'rules.toml', directory: 'src' })).toEqual([
      '--config',
      'rules.toml',
      '--root',
      'src',
    ])
    await expect(
      runGitleaksDirectoryScan({
        config: 'rules.toml',
        directory: 'src',
        execute: async () => 3,
      }),
    ).resolves.toBe(3)
  })

  it('requires non-empty config and directory paths', () => {
    expect(() => gitleaksDirectoryScanArguments({ config: '' })).toThrow('--config requires a path')
    expect(() => gitleaksDirectoryScanArguments({ config: 'rules.toml', directory: '' })).toThrow(
      '--directory requires a path',
    )
  })
})
