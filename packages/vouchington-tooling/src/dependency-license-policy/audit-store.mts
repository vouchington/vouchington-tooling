import { chmodSync, lstatSync, mkdirSync } from 'node:fs'

export interface DirectoryIdentity {
  readonly isDirectory: () => boolean
  readonly isSymbolicLink: () => boolean
  readonly mode: number
  readonly uid: number
}

export function assertOwnedDirectory(
  stat: DirectoryIdentity,
  uid: number | undefined,
  directory: string,
): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`dependency license audit store is not a real directory: ${directory}`)
  }
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(`dependency license audit store is not owned by the current user: ${directory}`)
  }
}

/** Creates the private, per-run store beneath the disposable license audit workspace. */
export function ensurePrivateLicenseAuditStore(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  assertOwnedDirectory(stat, process.getuid?.(), directory)
  if ((stat.mode & 0o077) !== 0) chmodSync(directory, 0o700)
}
