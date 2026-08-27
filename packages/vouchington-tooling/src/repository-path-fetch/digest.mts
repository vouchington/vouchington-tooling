import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, lstatSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface BundleEntry {
  destination: string
  mode: string
  sha256: string
}

export async function bundleEntries(root: string): Promise<BundleEntry[]> {
  const entries: BundleEntry[] = []
  for (const destination of list(root)) {
    const stat = lstatSync(join(root, destination))
    entries.push({
      destination,
      mode: (stat.mode & 0o777).toString(8).padStart(4, '0'),
      sha256: await fileSha256(join(root, destination)),
    })
  }
  return entries
}

export async function bundleDigest(root: string): Promise<string> {
  return digestEntries(await bundleEntries(root))
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function digestEntries(entries: readonly BundleEntry[]): string {
  const digest = createHash('sha256')
  for (const entry of [...entries].sort(comparePaths)) {
    digest.update(entry.destination)
    digest.update('\0')
    digest.update(entry.mode)
    digest.update('\0')
    digest.update(entry.sha256)
    digest.update('\n')
  }
  return digest.digest('hex')
}

export function comparePaths(
  left: { destination: string },
  right: { destination: string },
): number {
  return Buffer.compare(Buffer.from(left.destination), Buffer.from(right.destination))
}

function list(root: string, current = root): string[] {
  const entries: string[] = []
  for (const name of readdirSync(current).sort()) {
    const absolute = join(current, name)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink())
      throw new Error(`symbolic link in bundle: ${relative(root, absolute)}`)
    if (stat.isDirectory()) entries.push(...list(root, absolute))
    else if (stat.isFile()) entries.push(relative(root, absolute).replaceAll('\\', '/'))
    /* v8 ignore start -- staged bundles contain only validated regular Git blobs */ else
      throw new Error(`unsupported bundle entry: ${relative(root, absolute)}`)
    /* v8 ignore stop */
  }
  return entries
}
