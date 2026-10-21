import { describe, expect, it, vi } from 'vitest'

import { runCli } from '../cli/index.mts'
import { parseCli } from '../cli/parse.mts'
import { commandUsage } from '../cli/usage.mts'
import { HOST_STORAGE_MINIMUM_FREE_BYTES } from './check.mts'
import { runHostStoragePreflightCli } from './cli.mts'
import { makeDependencies, requiredPath } from './host-storage.test-helpers.mts'
import type { HostStorageDependencies } from './preflight.mts'

const ENOUGH = HOST_STORAGE_MINIMUM_FREE_BYTES + 1n

function outputOf() {
  const messages: string[] = []
  return {
    messages,
    output: {
      error: (message: string) => messages.push(message),
      log: (message: string) => messages.push(message),
    },
  }
}

describe('host storage cli', () => {
  it('forwards the command and prints its usage', () => {
    expect(parseCli(['node', 'vouchington', 'host-storage', '--path', '/repo'])).toEqual({
      kind: 'host-storage',
      args: ['--path', '/repo'],
    })
    expect(commandUsage('host-storage')).toContain('--path')
  })

  it('distinguishes usage errors, warnings, low space, and success', async () => {
    const { messages, output } = outputOf()
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/low', { availableBytes: HOST_STORAGE_MINIMUM_FREE_BYTES - 1n, device: 2n }],
    ])
    const { dependencies } = makeDependencies({
      commandResults: new Map([['pnpm store path', new Error('pnpm unavailable')]]),
      filesystems,
    })

    await expect(runHostStoragePreflightCli(['--unknown'], dependencies, output)).resolves.toBe(2)
    expect(messages).toEqual([expect.stringContaining('usage error')])

    messages.length = 0
    await expect(runHostStoragePreflightCli(['--pnpm-store'], dependencies, output)).resolves.toBe(
      2,
    )
    expect(messages[0]).toContain('--path requires a path')

    messages.length = 0
    await expect(
      runHostStoragePreflightCli(['--path', '--repo'], dependencies, output),
    ).resolves.toBe(2)

    messages.length = 0
    await expect(
      runHostStoragePreflightCli(
        ['--minimum-free-bytes', 'nope', '--path', '/repo'],
        dependencies,
        output,
      ),
    ).resolves.toBe(2)

    messages.length = 0
    await expect(runHostStoragePreflightCli(['--path'], dependencies, output)).resolves.toBe(2)
    await expect(
      runHostStoragePreflightCli(
        ['--path', '/repo', '--discovery-timeout-ms'],
        dependencies,
        output,
      ),
    ).resolves.toBe(2)
    await expect(
      runHostStoragePreflightCli(['--path', '/repo', '--minimum-free-bytes'], dependencies, output),
    ).resolves.toBe(2)
    await expect(
      runHostStoragePreflightCli(
        ['--path', '/repo', '--docker-desktop-path'],
        dependencies,
        output,
      ),
    ).resolves.toBe(2)
    await expect(
      runHostStoragePreflightCli(
        ['--path', '/repo', '--discovery-timeout-ms', '0'],
        dependencies,
        output,
      ),
    ).resolves.toBe(2)
    await expect(
      runHostStoragePreflightCli(
        ['--path', '/repo', '--discovery-timeout-ms', '9999999999999999999'],
        dependencies,
        output,
      ),
    ).resolves.toBe(2)
    await expect(
      runHostStoragePreflightCli(
        ['--path', '/repo', '--discovery-timeout-ms', '2147483648'],
        dependencies,
        output,
      ),
    ).resolves.toBe(2)
    expect(messages.at(-1)).toContain('2147483647')

    messages.length = 0
    await expect(
      runHostStoragePreflightCli(
        [
          '--path',
          '/repo',
          '--docker-desktop-path',
          '/custom/Docker.raw',
          '--discovery-timeout-ms',
          '1',
          '--docker-root',
        ],
        { ...dependencies, platform: 'win32' },
        output,
      ),
    ).resolves.toBe(0)

    messages.length = 0
    await expect(
      runHostStoragePreflightCli(['--path', '/repo', '--pnpm-store'], dependencies, output),
    ).resolves.toBe(0)
    expect(messages).toEqual([
      expect.stringContaining('Warning:'),
      'Host storage preflight passed: 5.00 GiB minimum free.',
    ])

    messages.length = 0
    await expect(
      runHostStoragePreflightCli(
        ['--path', '/low', '--minimum-free-bytes', '0'],
        dependencies,
        output,
      ),
    ).resolves.toBe(0)
    expect(messages).toEqual(['Host storage preflight passed: 0.00 GiB minimum free.'])

    messages.length = 0
    await expect(
      runHostStoragePreflightCli(['--path', '/low'], dependencies, output),
    ).resolves.toBe(1)
    expect(messages[0]).toContain('Error:')
  })

  it('reports an unexpected runtime failure separately from usage errors', async () => {
    const { messages, output } = outputOf()
    const filesystems = new Map([['/repo', { availableBytes: ENOUGH, device: 1n }]])
    const { dependencies } = makeDependencies({ filesystems })
    const failing = {
      ...dependencies,
      get platform(): NodeJS.Platform {
        throw new Error('synthetic runtime failure')
      },
    } satisfies HostStorageDependencies

    await expect(
      runHostStoragePreflightCli(['--path', '/repo', '--docker-root'], failing, output),
    ).resolves.toBe(1)
    expect(messages).toEqual([expect.stringContaining('Host storage preflight failed')])
    expect(messages[0]).not.toContain('usage error')
  })

  it('runs the vouchington command against a real directory', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const dir = requiredPath('directory', process.cwd()).path
    try {
      await expect(
        runCli(['node', 'vouchington', 'host-storage', '--path', dir, '--minimum-free-bytes', '0']),
      ).resolves.toBe(0)
      expect(log).toHaveBeenCalledWith('Host storage preflight passed: 0.00 GiB minimum free.')
      expect(error).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })
})
