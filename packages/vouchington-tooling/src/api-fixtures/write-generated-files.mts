import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function writeGeneratedFiles({
  files,
  check = false,
  obsoleteDirectory,
  staleError,
}: {
  files: ReadonlyMap<string, string>
  check?: boolean
  obsoleteDirectory?: string
  staleError: (paths: string[]) => Error
}): Promise<void> {
  const obsoletePaths = obsoleteDirectory ? await obsoleteJsonPaths(obsoleteDirectory, files) : []
  const stale: string[] = []
  for (const [path, content] of files) {
    if (check) {
      const actual = await readFile(path, 'utf8').catch((err: NodeJS.ErrnoException) =>
        err.code === 'ENOENT' ? null : Promise.reject(err),
      )
      if (actual !== content) stale.push(path)
      continue
    }

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }

  if (check) stale.push(...obsoletePaths)
  else await Promise.all(obsoletePaths.map((path) => unlink(path)))

  if (stale.length > 0) throw staleError(stale)
}

async function obsoleteJsonPaths(
  directory: string,
  files: ReadonlyMap<string, string>,
): Promise<string[]> {
  const expected = new Set([...files.keys()].filter((path) => dirname(path) === directory))
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? [] : Promise.reject(err)),
  )

  const obsoletePaths: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name.endsWith('.json') && !expected.has(path)) {
      obsoletePaths.push(path)
    }
  }
  return obsoletePaths
}
