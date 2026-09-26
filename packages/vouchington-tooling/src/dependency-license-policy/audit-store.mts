import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STORE_DIRECTORY_NAME = 'dependency-license-audit-store'

export interface DirectoryIdentity {
  readonly isDirectory: () => boolean
  readonly isSymbolicLink: () => boolean
  readonly mode: number
  readonly uid: number
}

/** pnpm's cache directory. The audit store stays beside it so it is not the developer store. */
export function pnpmCacheDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  hostPlatform: NodeJS.Platform = process.platform,
): string {
  if (hostPlatform === 'darwin') return join(home, 'Library', 'Caches', 'pnpm')
  if (hostPlatform === 'win32') {
    return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'pnpm-cache')
  }
  return join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'pnpm')
}

export function licenseAuditStoreDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  hostPlatform: NodeJS.Platform = process.platform,
): string {
  return join(pnpmCacheDirectory(env, home, hostPlatform), STORE_DIRECTORY_NAME)
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

/** Creates the dedicated content-addressed store used by repeat license audits. */
export function ensurePrivateLicenseAuditStore(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  assertOwnedDirectory(stat, process.getuid?.(), directory)
  if ((stat.mode & 0o077) !== 0) chmodSync(directory, 0o700)
}
