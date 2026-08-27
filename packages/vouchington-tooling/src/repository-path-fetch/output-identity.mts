import { randomUUID } from 'node:crypto'
import { link, lstat, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export interface OutputIdentity {
  dev: string
  ino: string
  type: 'directory' | 'file'
}

export async function moveAtomic(
  from: string,
  to: string,
  unlinkSource: (path: string) => Promise<void> = unlink,
  removeLink: (path: string) => Promise<void> = unlink,
): Promise<void> {
  const identity = await outputIdentity(from)
  if (identity.type === 'directory') {
    await rename(from, to)
    return
  }
  await link(from, to)
  try {
    await unlinkSource(from)
  } catch (error) {
    await removeOwnedOutput(to, identity, removeLink)
    throw error
  }
}

export async function removeOwnedOutput(
  path: string,
  expected: OutputIdentity,
  removeOutput: (path: string) => Promise<void>,
): Promise<void> {
  const claimed = join(dirname(path), `.${basename(path)}.remove-${randomUUID()}`)
  try {
    await rename(path, claimed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const actual = await outputIdentity(claimed)
  if (!sameIdentity(actual, expected)) {
    await restoreClaim(claimed, path, actual)
    throw new Error(`published output ownership changed: ${path}`)
  }
  try {
    await removeOutput(claimed)
  } catch (error) {
    await restoreClaim(claimed, path, actual)
    throw error
  }
}

async function restoreClaim(
  claimed: string,
  path: string,
  identity: OutputIdentity,
): Promise<void> {
  if (identity.type === 'directory') {
    await rename(claimed, path)
    return
  }
  await link(claimed, path)
  await unlink(claimed)
}

export async function outputIdentity(path: string): Promise<OutputIdentity> {
  const stat = await lstat(path, { bigint: true })
  const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined
  if (!type) throw new Error('unsupported staged output')
  return { dev: String(stat.dev), ino: String(stat.ino), type }
}

export function isOutputIdentity(value: unknown): value is OutputIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const identity = value as Partial<OutputIdentity>
  return (
    typeof identity.dev === 'string' &&
    /^\d+$/.test(identity.dev) &&
    typeof identity.ino === 'string' &&
    /^\d+$/.test(identity.ino) &&
    (identity.type === 'directory' || identity.type === 'file')
  )
}

function sameIdentity(left: OutputIdentity, right: OutputIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.type === right.type
}
