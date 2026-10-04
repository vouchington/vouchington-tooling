import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRepoFixture, type RepoFixture } from './git-fixture.test-helpers.mts'
import { isolatedGitEnv, launchWorktreeRoot, resolveWorktree, runIsolatedGit } from './worktree.mts'

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

describe('isolatedGitEnv', () => {
  it('forces the C locale, drops LANGUAGE, and strips GIT_* variables', () => {
    vi.stubEnv('LANG', 'de_DE.UTF-8')
    vi.stubEnv('LC_ALL', 'de_DE.UTF-8')
    vi.stubEnv('LANGUAGE', 'de')
    vi.stubEnv('GIT_DIR', '/elsewhere')
    try {
      const env = isolatedGitEnv()
      expect(env.LC_ALL).toBe('C')
      expect(env).not.toHaveProperty('LANGUAGE')
      expect(env).not.toHaveProperty('GIT_DIR')
      expect(env.PATH).toBe(process.env.PATH)
    } finally {
      vi.unstubAllEnvs()
    }
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

  it('is undefined, not an error, when the launch directory is not inside a git worktree', async () => {
    await expect(launchWorktreeRoot(fixture.root, runIsolatedGit)).resolves.toBeUndefined()
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

  it('is undefined when git reports the directory is not a git repository', async () => {
    const outside = vi.fn().mockRejectedValue(
      Object.assign(new Error('Command failed'), {
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      }),
    )
    await expect(launchWorktreeRoot(fixture.main, outside)).resolves.toBeUndefined()
    const byMessage = vi.fn().mockRejectedValue(new Error('fatal: Not a git repository'))
    await expect(launchWorktreeRoot(fixture.main, byMessage)).resolves.toBeUndefined()
  })

  it('throws an actionable error, keeping the cause, for any other git failure', async () => {
    const unsafe = Object.assign(new Error('Command failed'), {
      stderr: "fatal: detected dubious ownership in repository at '/x'",
    })
    await expect(
      launchWorktreeRoot(fixture.main, vi.fn().mockRejectedValue(unsafe)),
    ).rejects.toMatchObject({
      message: expect.stringContaining('git could not determine the worktree'),
      cause: unsafe,
    })
    await expect(
      launchWorktreeRoot(fixture.main, vi.fn().mockRejectedValue('spawn refused')),
    ).rejects.toThrow('spawn refused')
    await expect(launchWorktreeRoot(fixture.main, vi.fn().mockRejectedValue(null))).rejects.toThrow(
      'safe.directory',
    )
  })

  it('throws for a directory that does not exist, instead of treating it as outside', async () => {
    await expect(launchWorktreeRoot(join(fixture.root, 'missing'), runIsolatedGit)).rejects.toThrow(
      'git could not determine the worktree',
    )
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

  it('propagates a git failure that is not "not a git repository" instead of rejecting the path', async () => {
    const broken = vi.fn().mockRejectedValue(new Error('git: command not found'))
    await expect(
      resolveWorktree({ launchRoot: fixture.main, requested: fixture.main, runGit: broken }),
    ).rejects.toThrow('git could not determine the worktree')
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
