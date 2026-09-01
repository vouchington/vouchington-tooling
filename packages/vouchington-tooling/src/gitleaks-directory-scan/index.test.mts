import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

import { gitleaksDirectoryScanArguments, runGitleaksDirectoryScan } from './index.mts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

function mockChildProcess(event: 'close' | 'error', value: number | null | Error): void {
  vi.mocked(spawn).mockImplementation((() => {
    const child = {
      once(name: string, callback: (value: number | null | Error) => void) {
        if (name === event) queueMicrotask(() => callback(value))
        return child
      },
    }
    return child
  }) as never)
}

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

  it('uses the default executor and resolves the child exit code', async () => {
    mockChildProcess('close', 7)
    await expect(runGitleaksDirectoryScan({ config: '.gitleaks.toml' })).resolves.toBe(7)
    expect(spawn).toHaveBeenCalledWith(
      'bash',
      [expect.stringMatching(/gitleaks-directory-scan\.sh$/), '--config', '.gitleaks.toml'],
      { stdio: 'inherit' },
    )
  })

  it('uses exit code one when the child closes without a code', async () => {
    mockChildProcess('close', null)
    await expect(runGitleaksDirectoryScan({ config: '.gitleaks.toml' })).resolves.toBe(1)
  })

  it('rejects when the default executor cannot spawn the child', async () => {
    mockChildProcess('error', new Error('spawn failure'))
    await expect(runGitleaksDirectoryScan({ config: '.gitleaks.toml' })).rejects.toThrow(
      'spawn failure',
    )
  })
})
