import { execFileSync } from 'node:child_process'
import { copyFile, lstat, mkdir, readlink, realpath, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, matchesGlob, relative, sep } from 'node:path'

function within(root: string, path: string): boolean {
  const difference = relative(root, path)
  return difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
}

export function trackedPaths(repoRoot: string, remaining?: () => number): string[] {
  const output = execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024,
    timeout: remaining?.(),
    killSignal: 'SIGKILL',
  })
  return [...new Set(output.toString('utf8').split('\0').filter(Boolean))]
}

export async function copyTrackedWorkingTree(
  repoRoot: string,
  snapshotRoot: string,
  remaining?: () => number,
  ignore: readonly string[] = [],
): Promise<number> {
  const root = await realpath(repoRoot)
  const paths = trackedPaths(root, remaining).filter(
    (path) => !ignore.some((glob) => matchesGlob(path, glob)),
  )
  let copied = 0
  for (let index = 0; index < paths.length; index += 64) {
    const batch = await Promise.all(
      paths.slice(index, index + 64).map(async (path) => {
        const source = join(root, path)
        const target = join(snapshotRoot, path)
        if (!within(root, source) || !within(snapshotRoot, target)) {
          throw new Error(`Tracked path escapes the repository: ${path}`)
        }
        let sourceParent: string
        try {
          sourceParent = await realpath(dirname(source))
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false // tracked deletion
          throw err
        }
        if (!within(root, sourceParent))
          throw new Error(`Tracked path escapes the repository: ${path}`)
        let info
        try {
          info = await lstat(source)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false // tracked deletion
          throw err
        }
        await mkdir(dirname(target), { recursive: true })
        const resolved = await realpath(source)
        if (!within(root, resolved)) throw new Error(`Tracked path escapes the repository: ${path}`)
        if (info.isSymbolicLink()) {
          const link = await readlink(source)
          const targetLink = isAbsolute(link)
            ? relative(dirname(target), join(snapshotRoot, relative(root, resolved)))
            : link
          await symlink(targetLink, target)
        } else if (info.isFile()) {
          await copyFile(source, target)
        } else {
          throw new Error(`Tracked path is neither a file nor an internal symlink: ${path}`)
        }
        return true
      }),
    )
    copied += batch.filter(Boolean).length
  }
  if (copied === 0) throw new Error('Tracked snapshot contains no files')
  return copied
}
