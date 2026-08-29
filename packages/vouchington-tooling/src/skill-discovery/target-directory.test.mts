import { lstat, mkdtemp, mkdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { linkDirectoryEntry, resolveTargetDirectory } from './target-directory.mts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => rm(path, { force: true, recursive: true })),
  )
})

describe('target directory', () => {
  it('rejects a missing target without creating it', async () => {
    const root = await fixture()
    const target = join(root, 'missing')

    await expect(resolveTargetDirectory(target)).rejects.toThrow('Target root must exist')
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not follow an ancestor swapped after it is verified', async () => {
    const root = await fixture()
    const parent = join(root, 'parent')
    const target = join(parent, 'target')
    const moved = join(root, 'parent-moved')
    const victim = join(root, 'victim')
    await mkdir(target, { recursive: true })
    await mkdir(victim)

    await expect(
      resolveTargetDirectory(target, async () => {
        await rename(parent, moved)
        await symlink(victim, parent, 'dir')
      }),
    ).rejects.toThrow('Target root changed while resolving')
    await expect(lstat(join(victim, 'target', 'agent-workflow'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects an ancestor replaced by another physical directory', async () => {
    const root = await fixture()
    const parent = join(root, 'parent')
    const target = join(parent, 'target')
    const moved = join(root, 'parent-moved')
    await mkdir(target, { recursive: true })

    await expect(
      resolveTargetDirectory(target, async () => {
        await rename(parent, moved)
        await mkdir(target, { recursive: true })
      }),
    ).rejects.toThrow('Target root changed while resolving')
  })

  it('accepts an unchanged target after a worker creates or finds its entry', async () => {
    const root = await fixture()
    const targetPath = join(root, 'target')
    await mkdir(targetPath)
    const target = await resolveTargetDirectory(targetPath)

    await expect(
      linkDirectoryEntry('source', target, 'skill', undefined, async () => 'created'),
    ).resolves.toBe(true)
    await expect(
      linkDirectoryEntry('source', target, 'skill', undefined, async () => 'existing'),
    ).resolves.toBe(false)
  })
})

async function fixture(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'vouchington-target-directory-')))
  directories.push(directory)
  return directory
}
