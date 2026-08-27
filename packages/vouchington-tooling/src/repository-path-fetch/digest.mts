import { createHash } from 'node:crypto'
import { constants, lstatSync, readdirSync, type BigIntStats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join, relative } from 'node:path'

export interface BundleEntry {
  destination: string
  mode: string
  sha256: string
}

export async function bundleEntries(
  root: string,
  expectedModes?: ReadonlyMap<string, string>,
  statRoot: (path: string, options: { bigint: true }) => BigIntStats = lstatSync,
): Promise<BundleEntry[]> {
  const before = statRoot(root, { bigint: true })
  if (before.isSymbolicLink() || !before.isDirectory())
    throw new Error(`bundle root is not a real directory: ${root}`)
  const entries: BundleEntry[] = []
  for (const destination of list(root)) {
    entries.push({
      destination,
      mode: expectedModes?.get(destination) ?? '0644',
      sha256: await sha256RegularFile(join(root, destination)),
    })
  }
  if (
    expectedModes &&
    (entries.length !== expectedModes.size ||
      entries.some((entry) => !expectedModes.has(entry.destination)))
  )
    throw new Error('bundle files do not match validated Git tree')
  const after = statRoot(root, { bigint: true })
  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    after.dev !== before.dev ||
    after.ino !== before.ino
  )
    throw new Error('bundle root changed while hashing')
  return entries.sort(comparePaths)
}

export async function bundleDigest(
  root: string,
  expectedModes: ReadonlyMap<string, string>,
): Promise<string> {
  return digestEntries(await bundleEntries(root, expectedModes))
}

export async function sha256RegularFile(
  path: string,
  openFile: typeof open = open,
  lstatFile: typeof lstat = lstat,
): Promise<string> {
  const before = await lstatFile(path)
  if (before.isSymbolicLink() || !before.isFile())
    throw new Error(`unsupported bundle entry: ${path}`)
  const flags =
    process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW
  const file = await openFile(path, flags)
  try {
    const opened = await file.stat()
    const after = await lstatFile(path)
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    )
      throw new Error('bundle file changed while opening')
    const hash = createHash('sha256')
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk)
    const completed = await file.stat()
    if (
      completed.size !== opened.size ||
      completed.mtimeMs !== opened.mtimeMs ||
      completed.ctimeMs !== opened.ctimeMs
    )
      throw new Error('bundle file changed while hashing')
    return hash.digest('hex')
  } finally {
    await file.close()
  }
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
