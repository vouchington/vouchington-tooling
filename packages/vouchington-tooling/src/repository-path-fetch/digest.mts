import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, lstatSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface BundleEntry {
  destination: string
  mode: string
  sha256: string
}

export function bundleEntries(root: string): BundleEntry[] {
  return list(root).map((destination) => {
    const stat = lstatSync(join(root, destination))
    if (stat.isSymbolicLink()) throw new Error(`symbolic link in bundle: ${destination}`)
    return {
      destination,
      mode: (stat.mode & 0o777).toString(8).padStart(4, '0'),
      sha256: createHash('sha256')
        .update(readFileSync(join(root, destination)))
        .digest('hex'),
    }
  })
}

export function bundleDigest(root: string): string {
  return digestEntries(bundleEntries(root))
}

export function digestEntries(entries: readonly BundleEntry[]): string {
  const digest = createHash('sha256')
  for (const entry of [...entries].sort((left, right) =>
    left.destination.localeCompare(right.destination),
  )) {
    digest.update(entry.destination)
    digest.update('\0')
    digest.update(entry.mode)
    digest.update('\0')
    digest.update(entry.sha256)
    digest.update('\n')
  }
  return digest.digest('hex')
}

function list(root: string, current = root): string[] {
  const entries: string[] = []
  for (const name of readdirSync(current).sort()) {
    const absolute = join(current, name)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink())
      throw new Error(`symbolic link in bundle: ${relative(root, absolute)}`)
    if (stat.isDirectory()) entries.push(...list(root, absolute))
    else if (stat.isFile()) entries.push(relative(root, absolute))
    else throw new Error(`unsupported bundle entry: ${relative(root, absolute)}`)
  }
  return entries
}
