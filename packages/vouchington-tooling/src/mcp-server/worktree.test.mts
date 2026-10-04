import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRepoFixture, type RepoFixture } from './git-fixture.test-helpers.mts'
import { launchWorktreeRoot, resolveWorktree, runIsolatedGit } from './worktree.mts'

let fixture: RepoFixture
beforeAll(() => {
  fixture = createRepoFixture()
})
afterAll(() => fixture.cleanup())

const resolve = (requested?: string, ...launch: [launchRoot?: string | undefined]) =>
  resolveWorktree({
    launchRoot: launch.length === 0 ? fixture.main : launch[0],
    requested,
    runGit: runIsolatedGit,
  })

describe('launchWorktreeRoot', () => {
  it('returns the real worktree root from the root, a subdirectory, or a symlink', async () => {
    const nested = join(fixture.main, 'nested', 'deeper')
    mkdirSync(nested, { recursive: true })
    await expect(launchWorktreeRoot(fixture.main, runIsolatedGit)).resolves.toBe(fixture.main)
    await expect(launchWorktreeRoot(nested, runIsolatedGit)).resolves.toBe(fixture.main)
    await expect(launchWorktreeRoot(fixture.alias, runIsolatedGit)).resolves.toBe(fixture.linked)
  })

  it('is undefined, not an error, when the launch directory is not inside a git worktree', async () => {
    await expect(launchWorktreeRoot(fixture.root, runIsolatedGit)).resolves.toBeUndefined()
    await expect(
      launchWorktreeRoot(join(fixture.root, 'missing'), runIsolatedGit),
    ).resolves.toBeUndefined()
  })

  it('ignores GIT_DIR from the environment', async () => {
    vi.stubEnv('GIT_DIR', join(fixture.outside, '.git'))
    try {
      await expect(launchWorktreeRoot(fixture.main, runIsolatedGit)).resolves.toBe(fixture.main)
      await expect(resolve(fixture.root, undefined)).rejects.toThrow('not the top level')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('is undefined when the git runner fails with a non-Error', async () => {
    const failing = vi.fn().mockRejectedValue('spawn refused')
    await expect(launchWorktreeRoot(fixture.main, failing)).resolves.toBeUndefined()
  })
})

describe('resolveWorktree', () => {
  it('defaults to the launch worktree', async () => {
    await expect(resolve()).resolves.toBe(fixture.main)
  })

  it('asks for an explicit worktree when the server was launched outside a git worktree', async () => {
    await expect(resolve(undefined, undefined)).rejects.toThrow(
      'worktree is required: this server was launched outside a git worktree',
    )
    await expect(resolve(fixture.main, undefined)).resolves.toBe(fixture.main)
  })

  it('accepts the primary and linked worktrees of a repository', async () => {
    await expect(resolve(fixture.main)).resolves.toBe(fixture.main)
    await expect(resolve(fixture.linked)).resolves.toBe(fixture.linked)
    await expect(resolve(fixture.main, fixture.linked)).resolves.toBe(fixture.main)
  })

  it('accepts the worktree of an unrelated repository, whatever the launch worktree', async () => {
    await expect(resolve(fixture.outside)).resolves.toBe(fixture.outside)
    await expect(resolve(fixture.outside, undefined)).resolves.toBe(fixture.outside)
  })

  it('accepts a symlink to a worktree and returns its real path', async () => {
    await expect(resolve(fixture.alias)).resolves.toBe(fixture.linked)
  })

  it('accepts a worktree created after the server started and rejects it once removed', async () => {
    const late = join(fixture.root, 'late')
    await expect(resolve(late)).rejects.toThrow('not the top level of a git worktree')
    fixture.git(fixture.main, 'worktree', 'add', '--quiet', '-b', 'late', late)
    await expect(resolve(late)).resolves.toBe(late)
    fixture.git(fixture.main, 'worktree', 'remove', '--force', late)
    await expect(resolve(late)).rejects.toThrow('not the top level of a git worktree')
  })

  it('rejects the launch worktree itself once it was removed', async () => {
    const gone = join(fixture.root, 'gone')
    fixture.git(fixture.main, 'worktree', 'add', '--quiet', '-b', 'gone', gone)
    rmSync(gone, { recursive: true, force: true })
    await expect(resolve(undefined, gone)).rejects.toThrow(`worktree ${gone} is not the top level`)
    fixture.git(fixture.main, 'worktree', 'prune')
  })

  it('rejects a subdirectory of a worktree', async () => {
    const nested = join(fixture.main, 'nested')
    mkdirSync(nested, { recursive: true })
    await expect(resolve(nested)).rejects.toThrow(`worktree ${nested} is not the top level`)
  })

  it('rejects a directory that is not inside any git worktree', async () => {
    await expect(resolve(fixture.root)).rejects.toThrow(`worktree ${fixture.root} is not the top`)
  })

  it('rejects the git directory of a repository', async () => {
    await expect(resolve(join(fixture.main, '.git'))).rejects.toThrow('not the top level')
  })

  it('rejects relative and nonexistent paths', async () => {
    await expect(resolve('main')).rejects.toThrow('worktree must be an absolute path')
    await expect(resolve(join(fixture.root, 'missing'))).rejects.toThrow('not the top level')
  })
})
