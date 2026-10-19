import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { HOST_STORAGE_MINIMUM_FREE_BYTES, probeHostStorage } from './check.mts'
import { makeDependencies, requiredPath, standardPaths } from './host-storage.test-helpers.mts'
import { DOCKER_DESKTOP_STORAGE_RELATIVE_PATH, inspectHostStorage } from './preflight.mts'

const ENOUGH = HOST_STORAGE_MINIMUM_FREE_BYTES + 1n

describe('host storage probe', () => {
  it('uses a fixed 5 GiB floor and accepts exact equality', async () => {
    expect(HOST_STORAGE_MINIMUM_FREE_BYTES).toBe(5n * 1024n ** 3n)
    const filesystems = new Map([
      ['/repo', { availableBytes: HOST_STORAGE_MINIMUM_FREE_BYTES, device: 1n }],
      ['/home/developer', { availableBytes: HOST_STORAGE_MINIMUM_FREE_BYTES, device: 2n }],
      ['/tmp', { availableBytes: HOST_STORAGE_MINIMUM_FREE_BYTES, device: 2n }],
    ])
    const { dependencies } = makeDependencies({ filesystems })

    const result = await probeHostStorage(standardPaths(), dependencies)

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('checks caller paths and deduplicates filesystems by device', async () => {
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/home/developer', { availableBytes: ENOUGH, device: 2n }],
      ['/tmp', { availableBytes: ENOUGH, device: 2n }],
    ])
    const { dependencies, statfsCalls } = makeDependencies({ filesystems })

    const result = await inspectHostStorage({ paths: standardPaths() }, dependencies)

    expect(result.ok).toBe(true)
    expect(statfsCalls).toEqual(['/repo', '/home/developer'])
    expect(result.filesystems).toHaveLength(2)
    expect(result.filesystems[1]?.labels).toEqual(['home directory', 'temporary directory'])
  })

  it('honors a caller minimum and reports fractional gibibytes', async () => {
    const filesystems = new Map([['/repo', { availableBytes: 53_687_092n, device: 1n }]])
    const { dependencies } = makeDependencies({ filesystems })

    const result = await inspectHostStorage(
      { minimumFreeBytes: 1024n ** 3n, paths: [requiredPath('worktree', '/repo')] },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.issues[0]?.message).toContain('0.05 GiB free; 1.00 GiB required')
  })

  it('deduplicates recovery guidance for candidates on the same low filesystem', async () => {
    const low = HOST_STORAGE_MINIMUM_FREE_BYTES - 1n
    const filesystems = new Map([
      ['/repo', { availableBytes: HOST_STORAGE_MINIMUM_FREE_BYTES, device: 1n }],
      ['/home/developer', { availableBytes: low, device: 2n }],
      ['/tmp', { availableBytes: low, device: 2n }],
    ])
    const { dependencies } = makeDependencies({ filesystems })

    const result = await inspectHostStorage({ paths: standardPaths() }, dependencies)
    const message = result.issues.find((issue) => issue.type === 'low-space')?.message ?? ''

    expect(message.match(/Free host storage, then retry/g)).toHaveLength(1)
  })

  it('blocks when a required path cannot be resolved, stated, or probed', async () => {
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/tmp', { availableBytes: ENOUGH, device: 2n }],
    ])
    const { dependencies } = makeDependencies({
      filesystems,
      realpathFailures: new Set(['/home/developer']),
      statFailures: new Set(['/repo']),
      statfsFailures: new Set(['/tmp']),
    })

    const result = await inspectHostStorage({ paths: standardPaths() }, dependencies)

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'home directory', severity: 'error', type: 'resolution' }),
        expect.objectContaining({ label: 'worktree', severity: 'error', type: 'probe' }),
        expect.objectContaining({
          label: 'temporary directory',
          severity: 'error',
          type: 'probe',
        }),
      ]),
    )
  })

  it('quotes diagnostic paths and does not suggest deleting data', async () => {
    const filesystems = new Map([
      ["/repo/it's here", { availableBytes: HOST_STORAGE_MINIMUM_FREE_BYTES - 1n, device: 1n }],
    ])
    const { dependencies } = makeDependencies({ filesystems })

    const result = await inspectHostStorage(
      { paths: [requiredPath('worktree', "/repo/it's here")] },
      dependencies,
    )
    const message = result.issues[0]?.message ?? ''

    expect(message).toContain(`df -h '/repo/it'"'"'s here'`)
    expect(message).toContain('Free host storage, then retry')
    expect(message).not.toMatch(/\brm\b/)
  })

  it('stringifies a non-error resolution failure', async () => {
    const { dependencies } = makeDependencies({ thrown: new Map([['/repo', 'gone']]) })

    const result = await probeHostStorage([requiredPath('worktree', '/repo')], dependencies, 1n)

    expect(result.issues[0]?.message).toContain('gone')
    expect(result.issues[0]?.severity).toBe('error')
  })

  it('measures a real directory with the default dependencies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'host-storage-'))
    try {
      const result = await inspectHostStorage({
        minimumFreeBytes: 0n,
        paths: [requiredPath('directory', dir)],
      })
      expect(result.filesystems[0]?.availableBytes).toBeGreaterThanOrEqual(0n)
      expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })
})

describe('host storage discovery', () => {
  it('warns when optional pnpm and Docker paths cannot be discovered', async () => {
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/home/developer', { availableBytes: ENOUGH, device: 2n }],
      ['/tmp', { availableBytes: ENOUGH, device: 2n }],
    ])
    const commandResults = new Map<string, Error | string>([
      ['pnpm store path', new Error('pnpm unavailable')],
      ['docker info --format {{.DockerRootDir}}', new Error('daemon unavailable')],
    ])
    const { commandCalls, dependencies } = makeDependencies({ commandResults, filesystems })

    const result = await inspectHostStorage(
      { discoverDockerRoot: true, discoverPnpmStore: true, paths: standardPaths() },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([
      expect.objectContaining({ label: 'pnpm store', severity: 'warning', type: 'resolution' }),
      expect.objectContaining({ label: 'Docker root', severity: 'warning', type: 'resolution' }),
    ])
    expect(commandCalls).toEqual([
      { args: ['store', 'path'], command: 'pnpm', timeout: 5_000 },
      { args: ['info', '--format', '{{.DockerRootDir}}'], command: 'docker', timeout: 5_000 },
    ])
  })

  it('warns on an empty command path and passes the caller timeout', async () => {
    const filesystems = new Map([['/repo', { availableBytes: ENOUGH, device: 1n }]])
    const { commandCalls, dependencies } = makeDependencies({
      commandResults: new Map([['pnpm store path', ' \n']]),
      filesystems,
    })

    const result = await inspectHostStorage(
      {
        discoverPnpmStore: true,
        discoveryTimeoutMs: 25,
        paths: [requiredPath('worktree', '/repo')],
      },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.issues[0]?.message).toContain('empty path')
    expect(commandCalls[0]?.timeout).toBe(25)
  })

  it('warns on optional probe failures but blocks when a discovered filesystem is low', async () => {
    const low = HOST_STORAGE_MINIMUM_FREE_BYTES - 1n
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/home/developer', { availableBytes: ENOUGH, device: 2n }],
      ['/tmp', { availableBytes: ENOUGH, device: 2n }],
      ['/pnpm/store', { availableBytes: ENOUGH, device: 3n }],
      ['/var/lib/docker', { availableBytes: low, device: 4n }],
    ])
    const commandResults = new Map<string, Error | string>([
      ['pnpm store path', '/pnpm/store\n'],
      ['docker info --format {{.DockerRootDir}}', '/var/lib/docker\n'],
    ])
    const { dependencies } = makeDependencies({
      commandResults,
      filesystems,
      statfsFailures: new Set(['/pnpm/store']),
    })

    const result = await inspectHostStorage(
      { discoverDockerRoot: true, discoverPnpmStore: true, paths: standardPaths() },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'pnpm store', severity: 'warning', type: 'probe' }),
        expect.objectContaining({ label: 'Docker root', severity: 'error', type: 'low-space' }),
      ]),
    )
  })

  it('uses the Docker Desktop backing file on macOS, including a caller override', async () => {
    const dockerRaw = `/Users/developer/${DOCKER_DESKTOP_STORAGE_RELATIVE_PATH}`
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/Users/developer', { availableBytes: ENOUGH, device: 2n }],
      ['/tmp', { availableBytes: ENOUGH, device: 2n }],
      [dockerRaw, { availableBytes: ENOUGH, device: 2n }],
      ['/custom/Docker.raw', { availableBytes: ENOUGH, device: 3n }],
    ])
    const { commandCalls, dependencies } = makeDependencies({
      filesystems,
      home: '/Users/developer',
      platform: 'darwin',
    })

    const discovered = await inspectHostStorage(
      { discoverDockerRoot: true, paths: standardPaths('/Users/developer') },
      dependencies,
    )
    expect(discovered.ok).toBe(true)
    expect(discovered.filesystems[1]?.labels).toContain('Docker Desktop storage')
    expect(commandCalls).toEqual([])

    const overridden = await inspectHostStorage(
      {
        discoverDockerRoot: true,
        dockerDesktopPath: '/custom/Docker.raw',
        paths: [requiredPath('worktree', '/repo')],
      },
      dependencies,
    )
    expect(overridden.filesystems.map((filesystem) => filesystem.path)).toContain(
      '/custom/Docker.raw',
    )
  })

  it('warns when Docker discovery is unsupported on the host platform', async () => {
    const filesystems = new Map([['/repo', { availableBytes: ENOUGH, device: 1n }]])
    const { dependencies } = makeDependencies({ filesystems, platform: 'win32' })

    const result = await inspectHostStorage(
      { discoverDockerRoot: true, paths: [requiredPath('worktree', '/repo')] },
      dependencies,
    )

    expect(result.ok).toBe(true)
    expect(result.issues[0]?.message).toContain('unsupported host platform win32')
    expect(result.issues[0]?.severity).toBe('warning')
  })

  it('finishes required probes before optional discovery can invoke commands', async () => {
    const operations: string[] = []
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/home/developer', { availableBytes: ENOUGH, device: 2n }],
      ['/tmp', { availableBytes: ENOUGH, device: 3n }],
      ['/pnpm/store', { availableBytes: ENOUGH, device: 4n }],
    ])
    const { dependencies } = makeDependencies({
      commandResults: new Map([['pnpm store path', '/pnpm/store\n']]),
      filesystems,
    })
    const wrapped = {
      ...dependencies,
      execFile: async (command: string, args: string[], options: { timeout: number }) => {
        operations.push(`command:${command} ${args.join(' ')}`)
        return dependencies.execFile(command, args, options)
      },
      statfs: async (path: string) => {
        operations.push(`statfs:${path}`)
        return dependencies.statfs(path)
      },
    }

    const result = await inspectHostStorage(
      { discoverPnpmStore: true, paths: standardPaths() },
      wrapped,
    )

    expect(result.ok).toBe(true)
    expect(operations.slice(0, 3)).toEqual([
      'statfs:/repo',
      'statfs:/home/developer',
      'statfs:/tmp',
    ])
    expect(operations[3]).toBe('command:pnpm store path')
  })

  it('does not run optional discovery when a required filesystem fails', async () => {
    const filesystems = new Map([
      ['/repo', { availableBytes: ENOUGH, device: 1n }],
      ['/home/developer', { availableBytes: HOST_STORAGE_MINIMUM_FREE_BYTES - 1n, device: 2n }],
      ['/tmp', { availableBytes: ENOUGH, device: 3n }],
    ])
    const { commandCalls, dependencies } = makeDependencies({ filesystems })

    const result = await inspectHostStorage(
      { discoverDockerRoot: true, discoverPnpmStore: true, paths: standardPaths() },
      dependencies,
    )

    expect(result.ok).toBe(false)
    expect(commandCalls).toEqual([])
  })
})
