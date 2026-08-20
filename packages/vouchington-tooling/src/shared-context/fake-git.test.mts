import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearFakeGitEnv,
  installFakeGit,
  setFakeGitTrackedFiles,
  type FakeGitOptions,
} from './fake-git.mts'

const execFileAsync = promisify(execFile)

describe('fake-git', () => {
  const testDirs: string[] = []
  const originalEnv = { ...process.env }

  afterEach(async () => {
    process.env.PATH = originalEnv.PATH
    clearFakeGitEnv()
    await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function install(options: Omit<FakeGitOptions, 'binDir'> = {}) {
    const binDir = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'fake-git-'))
    testDirs.push(binDir)
    installFakeGit({ binDir, pathPrefix: originalEnv.PATH ?? '', ...options })
    return binDir
  }

  it('lists tracked files after setFakeGitTrackedFiles', async () => {
    await install({ repoRoot: '/repo', trackedFiles: ['a.mts'] })
    setFakeGitTrackedFiles(['b.mts', 'a.mts'])
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'])
    expect(stdout.split('\0').filter(Boolean)).toEqual(['a.mts', 'b.mts'])
  })

  it('lists files when invoked as git ls-files without -z', async () => {
    await install({ repoRoot: '/repo', trackedFiles: ['only.mts'] })
    const { stdout } = await execFileAsync('git', ['ls-files'])
    expect(stdout.split('\0').filter(Boolean)).toEqual(['only.mts'])
  })

  it('rejects unexpected git invocations', async () => {
    await install({ repoRoot: '/repo' })
    await expect(execFileAsync('git', ['status'])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('unexpected fake git invocation'),
    })
  })
})
