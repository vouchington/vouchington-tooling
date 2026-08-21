import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { lstatOrNull } from './file-safety.mts'

function unsafeSchemaSnapshotPath(path: string): Error {
  return new Error(`Unsafe generated PostgreSQL schema snapshot path: ${path}`)
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return collectMarkdownFiles(path)
      return entry.isFile() || entry.isSymbolicLink() ? [path] : []
    }),
  )
  return paths.flat()
}

export async function markdownFilesOnDisk(root: string): Promise<string[]> {
  const markdownRoot = join(root, 'markdown')
  const markdownRootStats = await lstatOrNull(markdownRoot)
  if (markdownRootStats === null) return []
  if (markdownRootStats.isSymbolicLink() || !markdownRootStats.isDirectory()) {
    throw unsafeSchemaSnapshotPath(markdownRoot)
  }
  return (await collectMarkdownFiles(markdownRoot)).toSorted((left, right) =>
    left.localeCompare(right),
  )
}
