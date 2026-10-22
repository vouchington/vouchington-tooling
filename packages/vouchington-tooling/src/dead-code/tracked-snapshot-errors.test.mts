import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyTrackedWorkingTree } from './tracked-snapshot.mts'

async function withRepo(run: (repo: string, snapshot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dead-code-snapshot-errors-'))
  const repo = join(root, 'repo')
  try {
    await mkdir(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
    await run(repo, join(root, 'snapshot'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function add(repo: string, ...paths: string[]): void {
  execFileSync('git', ['add', '-f', ...paths], { cwd: repo })
}

describe('tracked snapshot edge cases', () => {
  it('skips tracked deletions and fails when nothing remains', async () => {
    await withRepo(async (repo, snapshot) => {
      await writeFile(join(repo, 'gone.mts'), 'export {}\n')
      await mkdir(join(repo, 'dir'))
      await writeFile(join(repo, 'dir', 'gone.mts'), 'export {}\n')
      add(repo, 'gone.mts', 'dir/gone.mts')
      await rm(join(repo, 'gone.mts'))
      await rm(join(repo, 'dir'), { recursive: true })
      await expect(copyTrackedWorkingTree(repo, snapshot)).rejects.toThrow('contains no files')
    })
  })

  it('rethrows unexpected filesystem errors', async () => {
    await withRepo(async (repo, snapshot) => {
      await mkdir(join(repo, 'a'))
      await writeFile(join(repo, 'a', 'b.mts'), 'export {}\n')
      add(repo, 'a/b.mts')
      await rm(join(repo, 'a'), { recursive: true })
      await writeFile(join(repo, 'a'), 'now a file\n')
      await expect(copyTrackedWorkingTree(repo, snapshot)).rejects.toThrow('ENOTDIR')
    })
    await withRepo(async (repo, snapshot) => {
      await mkdir(join(repo, 'loop'))
      await writeFile(join(repo, 'loop', 'x.mts'), 'export {}\n')
      add(repo, 'loop/x.mts')
      await rm(join(repo, 'loop'), { recursive: true })
      await symlink('loop', join(repo, 'loop'))
      await expect(copyTrackedWorkingTree(repo, snapshot)).rejects.toThrow('ELOOP')
    })
  })

  it('rejects tracked entries that are neither files nor symlinks', async () => {
    await withRepo(async (repo, snapshot) => {
      await mkdir(join(repo, 'sub'))
      execFileSync(
        'git',
        ['update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},sub`],
        { cwd: repo },
      )
      await expect(copyTrackedWorkingTree(repo, snapshot)).rejects.toThrow(
        'neither a file nor an internal symlink',
      )
    })
  })

  it('rewrites an absolute internal symlink as a relative link', async () => {
    await withRepo(async (repo, snapshot) => {
      await writeFile(join(repo, 'target.mts'), 'export {}\n')
      await symlink(join(repo, 'target.mts'), join(repo, 'link.mts'))
      add(repo, 'target.mts', 'link.mts')
      expect(await copyTrackedWorkingTree(repo, snapshot)).toBe(2)
    })
  })
})
