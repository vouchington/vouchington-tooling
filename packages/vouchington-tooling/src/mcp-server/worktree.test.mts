import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRepoFixture, type RepoFixture } from './git-fixture.test-helpers.mts'
import {
  launchWorktreeRoot,
  parseWorktreeList,
  resolveWorktree,
  runIsolatedGit,
} from './worktree.mts'

let fixture: RepoFixture
beforeAll(() => {
  fixture = createRepoFixture()
})
afterAll(() => fixture.cleanup())

const resolve = (requested?: string, launchRoot = fixture.main) =>
  resolveWorktree({ launchRoot, requested, runGit: runIsolatedGit })

describe('parseWorktreeList', () => {
  it('lists non-bare worktrees and tolerates detached, locked, and prunable entries', () => {
    const porcelain = [
      'worktree /repo.git\nbare',
      'worktree /repo/main\nHEAD abc\nbranch refs/heads/main',
      'worktree /repo/detached\nHEAD def\ndetached\nlocked reason',
      'worktree /repo/gone\nHEAD 123\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location',
    ].join('\r\n\r\n')
    expect(parseWorktreeList(`${porcelain}\n`)).toEqual([
      '/repo/main',
      '/repo/detached',
      '/repo/gone',
    ])
    expect(parseWorktreeList('')).toEqual([])
    expect(parseWorktreeList('HEAD abc\n')).toEqual([])
  })
})

describe('launchWorktreeRoot', () => {
  it('returns the real worktree root from the root, a subdirectory, or a symlink', async () => {
    const nested = join(fixture.main, 'nested', 'deeper')
    mkdirSync(nested, { recursive: true })
    await expect(launchWorktreeRoot(fixture.main, runIsolatedGit)).resolves.toBe(fixture.main)
    await expect(launchWorktreeRoot(nested, runIsolatedGit)).resolves.toBe(fixture.main)
    await expect(launchWorktreeRoot(fixture.alias, runIsolatedGit)).resolves.toBe(fixture.linked)
  })

  it('names the launch directory when it is not inside a git worktree', async () => {
    await expect(launchWorktreeRoot(fixture.root, runIsolatedGit)).rejects.toThrow(
      `must be launched inside a git worktree; ${fixture.root} is not one`,
    )
  })

  it('ignores GIT_DIR from the environment', async () => {
    vi.stubEnv('GIT_DIR', join(fixture.outside, '.git'))
    try {
      await expect(launchWorktreeRoot(fixture.main, runIsolatedGit)).resolves.toBe(fixture.main)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reports non-Error failures from the git runner', async () => {
    const failing = vi.fn().mockRejectedValue('spawn refused')
    await expect(launchWorktreeRoot(fixture.main, failing)).rejects.toThrow('spawn refused')
  })
})

describe('resolveWorktree', () => {
  it('defaults to the launch worktree', async () => {
    await expect(resolve()).resolves.toBe(fixture.main)
  })

  it('accepts the primary and linked worktrees of the launch repository', async () => {
    await expect(resolve(fixture.main)).resolves.toBe(fixture.main)
    await expect(resolve(fixture.linked)).resolves.toBe(fixture.linked)
    await expect(resolve(fixture.main, fixture.linked)).resolves.toBe(fixture.main)
  })

  it('accepts a symlink to a worktree and returns its real path', async () => {
    await expect(resolve(fixture.alias)).resolves.toBe(fixture.linked)
  })

  it('accepts a worktree created after the server started and rejects it once removed', async () => {
    const late = join(fixture.root, 'late')
    await expect(resolve(late)).rejects.toThrow('is not a worktree of the repository')
    fixture.git(fixture.main, 'worktree', 'add', '--quiet', '-b', 'late', late)
    await expect(resolve(late)).resolves.toBe(late)
    fixture.git(fixture.main, 'worktree', 'remove', '--force', late)
    await expect(resolve(late)).rejects.toThrow('is not a worktree of the repository')
  })

  it('skips registered worktrees whose directory was deleted without failing', async () => {
    const gone = join(fixture.root, 'gone')
    fixture.git(fixture.main, 'worktree', 'add', '--quiet', '-b', 'gone', gone)
    rmSync(gone, { recursive: true, force: true })
    await expect(resolve()).resolves.toBe(fixture.main)
    await expect(resolve(gone)).rejects.toThrow('is not a worktree of the repository')
    fixture.git(fixture.main, 'worktree', 'prune')
  })

  it('rejects a separate repository made with git init', async () => {
    await expect(resolve(fixture.outside)).rejects.toThrow(
      `is not a worktree of the repository this server was launched from (${fixture.main})`,
    )
  })

  it('rejects a subdirectory of a listed worktree', async () => {
    const nested = join(fixture.main, 'nested')
    mkdirSync(nested, { recursive: true })
    await expect(resolve(nested)).rejects.toThrow('is not a worktree of the repository')
  })

  it('rejects relative and nonexistent paths', async () => {
    await expect(resolve('main')).rejects.toThrow('worktree must be an absolute path')
    await expect(resolve(join(fixture.root, 'missing'))).rejects.toThrow(
      'is not a worktree of the repository',
    )
  })

  it('lists the registered worktrees so the caller can correct the path', async () => {
    await expect(resolve(fixture.outside)).rejects.toThrow(
      `Registered worktrees: ${fixture.main}, ${fixture.linked}`,
    )
  })

  it('rejects the launch worktree itself once git no longer lists it', async () => {
    await expect(resolve(undefined, fixture.outside)).resolves.toBe(fixture.outside)
    const stale = vi.fn().mockResolvedValue(`worktree ${fixture.linked}\n`)
    await expect(
      resolveWorktree({ launchRoot: fixture.main, requested: undefined, runGit: stale }),
    ).rejects.toThrow(`worktree ${fixture.main} is not a worktree`)
  })
})
