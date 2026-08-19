import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./exec.mts', () => ({ runPnpm: vi.fn() }))

import { runPnpm } from './exec.mts'
import { INSTALL_TERMINATION_FAILED } from './process.mts'
import { formatReleaseAgeFailure } from './release-age.mts'
import { runInstallLifecycle } from './runner.mts'
import { findWorkspaceLinkMismatches } from './support.mts'

const mockedRun = vi.mocked(runPnpm)
const persistent = {
  commandTimeoutSeconds: 0,
  ephemeralWorkspaces: '',
  installScripts: true,
  maxAttempts: 1,
  runnerLifecycle: 'persistent' as const,
}

describe('remaining install coverage', () => {
  afterEach(() => {
    mockedRun.mockReset()
    vi.restoreAllMocks()
  })

  it('fails when an install attempt cannot terminate', async () => {
    mockedRun.mockResolvedValue({ code: INSTALL_TERMINATION_FAILED, output: '' })
    await expect(
      runInstallLifecycle({ ...persistent, runnerLifecycle: 'ephemeral-full' }),
    ).rejects.toThrow('could not terminate safely')
  })

  it('fails after the last retry of a transient install error', { timeout: 15_000 }, async () => {
    mockedRun.mockResolvedValue({ code: 1, output: 'transient' })
    await expect(
      runInstallLifecycle({ ...persistent, maxAttempts: 1, runnerLifecycle: 'ephemeral-full' }),
    ).rejects.toThrow('failed after 1 attempt')
    await expect(
      runInstallLifecycle({ ...persistent, maxAttempts: 2, runnerLifecycle: 'ephemeral-full' }),
    ).rejects.toThrow('failed after 2 attempts')
  })

  it('rejects selectors on ephemeral-full runners', async () => {
    await expect(
      runInstallLifecycle({
        ...persistent,
        ephemeralWorkspaces: '@fixture/app',
        runnerLifecycle: 'ephemeral-full',
      }),
    ).rejects.toThrow('only valid for filtered ephemeral runners')
  })

  it('warns when pnpm-workspace.yaml cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const previous = process.cwd()
    const directory = await mkdtemp(join(tmpdir(), 'release-age-cwd-'))
    try {
      process.chdir(directory)
      expect(formatReleaseAgeFailure('install', 'nope')).toContain('violation details')
      expect(
        formatReleaseAgeFailure(
          'install',
          '  undici@8.10.0 was published at 2026-08-03T15:06:33.000Z, within the minimumReleaseAge cutoff (2026-08-02T04:48:10.357Z)\n',
        ),
      ).not.toContain('eligible at')
      expect(warn).toHaveBeenCalled()
    } finally {
      process.chdir(previous)
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('sorts declared workspace dependencies by name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sort-'))
    await mkdir(join(root, 'pkg'), { recursive: true })
    await writeFile(
      join(root, 'pkg', 'package.json'),
      JSON.stringify({
        name: 'pkg',
        dependencies: { zeta: 'workspace:*', alpha: 'workspace:*' },
      }),
    )
    try {
      await expect(
        findWorkspaceLinkMismatches(async () => ({
          code: 0,
          output: JSON.stringify([{ name: 'pkg', path: join(root, 'pkg') }]),
        })),
      ).resolves.toEqual([
        expect.objectContaining({ dependency: 'alpha' }),
        expect.objectContaining({ dependency: 'zeta' }),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
