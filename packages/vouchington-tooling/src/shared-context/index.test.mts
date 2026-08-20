import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildSharedContext, gitEnv, runNamedChecks } from './index.mts'
import { clearFakeGitEnv, installFakeGit } from './fake-git.mts'

describe('shared-context', () => {
  const tempRoot = process.env.RUNNER_TEMP || tmpdir()
  const testDirs: string[] = []
  const originalEnv = { ...process.env }

  afterEach(async () => {
    process.env.PATH = originalEnv.PATH
    clearFakeGitEnv()
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function installFakeGitBin(
    options: {
      isInsideWorkTree?: boolean
      lsFilesExitCode?: number
      lsFilesStderr?: string
      repoRoot?: string
      trackedFiles?: readonly string[]
    } = {},
  ) {
    const binDir = await mkdtemp(join(tempRoot, 'shared-ctx-fake-git-'))
    testDirs.push(binDir)
    installFakeGit({ binDir, pathPrefix: originalEnv.PATH ?? '', ...options })
  }

  it('gitEnv() strips GIT_* keys', () => {
    const env = gitEnv()
    for (const key of Object.keys(env)) {
      expect(key.startsWith('GIT_')).toBe(false)
    }
  })

  it('buildSharedContext returns isInsideGitRepo: false for a non-git directory', async () => {
    await installFakeGitBin({ isInsideWorkTree: false })
    const dir = await mkdtemp(join(tempRoot, 'shared-ctx-shared-ctx-nogit-'))
    testDirs.push(dir)

    const ctx = await buildSharedContext(dir)

    expect(ctx.isInsideGitRepo).toBe(false)
    expect(ctx.repoRoot).toBe(dir)
    expect(ctx.trackedFiles).toEqual([])
    expect(ctx.trackedFileSet.size).toBe(0)
  })

  it('buildSharedContext returns resolved root and tracked file set', async () => {
    const dir = await mkdtemp(join(tempRoot, 'shared-ctx-shared-ctx-git-'))
    testDirs.push(dir)
    await installFakeGitBin({ repoRoot: dir, trackedFiles: ['sub/hello.mts'] })

    const ctx = await buildSharedContext(dir)

    expect(ctx).toMatchObject({ isInsideGitRepo: true, repoRoot: dir })
    expect(ctx.trackedFiles).toEqual(['sub/hello.mts'])
    expect(ctx.trackedFileSet.has('sub/hello.mts')).toBe(true)
  })

  it('buildSharedContext resolves repo root even when given a subdirectory', async () => {
    const dir = await mkdtemp(join(tempRoot, 'shared-ctx-shared-ctx-subdir-'))
    testDirs.push(dir)
    await mkdir(join(dir, 'sub'), { recursive: true })
    await installFakeGitBin({ repoRoot: dir, trackedFiles: ['sub/hello.mts'] })

    const ctx = await buildSharedContext(join(dir, 'sub'))

    expect(ctx.repoRoot).toBe(dir)
    expect(ctx.trackedFileSet.has('sub/hello.mts')).toBe(true)
  })

  it('shares tracked source contents by file', async () => {
    const dir = await mkdtemp(join(tempRoot, 'shared-ctx-shared-ctx-cache-'))
    testDirs.push(dir)
    await writeFile(join(dir, 'query.mts'), 'export const query = 1\n')
    await installFakeGitBin({ repoRoot: dir, trackedFiles: ['query.mts'] })

    const ctx = await buildSharedContext(dir)

    expect(ctx.readTrackedFile?.('query.mts')).toBe('export const query = 1\n')
    expect(ctx.readTrackedFile?.('query.mts')).toBe('export const query = 1\n')
    expect(ctx.readTrackedFile?.('untracked.mts')).toBeNull()
  })

  it('rejects with exact stderr when git ls-files exits nonzero', async () => {
    const dir = await mkdtemp(join(tempRoot, 'shared-ctx-shared-ctx-git-fail-'))
    testDirs.push(dir)
    await installFakeGitBin({
      lsFilesExitCode: 7,
      lsFilesStderr: 'cannot list files',
      repoRoot: dir,
    })

    await expect(buildSharedContext(dir)).rejects.toThrow(
      'git ls-files failed (exit 7): cannot list files',
    )
  })

  it('returns null when a tracked file cannot be read', async () => {
    const dir = await mkdtemp(join(tempRoot, 'shared-ctx-missing-file-'))
    testDirs.push(dir)
    await installFakeGitBin({ repoRoot: dir, trackedFiles: ['gone.mts'] })
    const ctx = await buildSharedContext(dir)
    expect(ctx.readTrackedFile?.('gone.mts')).toBeNull()
    expect(ctx.readTrackedFile?.('gone.mts')).toBeNull()
  })

  it('runs named checks against one shared context', async () => {
    const dir = await mkdtemp(join(tempRoot, 'shared-ctx-named-'))
    testDirs.push(dir)
    await writeFile(join(dir, 'ok.mts'), 'export {}\n')
    await installFakeGitBin({ repoRoot: dir, trackedFiles: ['ok.mts'] })
    const results = await runNamedChecks(dir, [
      {
        name: 'ok',
        run: (ctx) => ({ errors: ctx.trackedFiles.includes('ok.mts') ? [] : ['missing'] }),
      },
      { name: 'async-fail', run: async () => ({ errors: ['nope'], fixes: ['hint'] }) },
    ])
    expect(results).toEqual([
      { name: 'ok', errors: [] },
      { name: 'async-fail', errors: ['nope'], fixes: ['hint'] },
    ])
  })
})
