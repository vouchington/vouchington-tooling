import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readInstalledVersion } from '../cli/installed-version.mts'

/** What the running server knows about its own install, captured once at startup. */
export type InstallInfo = {
  name: string
  version: string
  /** Absolute path of the package directory this server was loaded from. */
  location: string
}

const PACKAGE_NAME = 'vouchington-tooling'

export function captureInstall(version: string = readInstalledVersion()): InstallInfo {
  return {
    name: PACKAGE_NAME,
    version,
    location: fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, ''),
  }
}

export function describeInstall(install: InstallInfo): string {
  return `${install.name} ${install.version} (${install.location})`
}

const MISSING_FILE = /ERR_MODULE_NOT_FOUND|Cannot find module|ENOENT|no such file/i

/**
 * The missing target only: the ENOENT `path`, else the first quoted specifier in the message
 * (`Cannot find module '<x>'`, `Cannot find package '<x>'`), never the "imported from" importer.
 */
function missingTarget(error: unknown, message: string): string | undefined {
  const path = (error as { path?: unknown } | null)?.path
  if (typeof path === 'string') return path
  return /'([^']+)'/.exec(message)?.[1]
}

/** True only for a missing-file failure whose missing target is inside the server's own install. */
function isInstallSwapped(error: unknown, install: InstallInfo): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  const text = `${typeof code === 'string' ? code : ''} ${message}`
  if (!MISSING_FILE.test(text)) return false
  const target = missingTarget(error, message)
  if (target === undefined || !isAbsolute(target)) return false
  const rel = relative(install.location, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** The suffix appended to every tool error so a stale or swapped install is obvious. */
export function installSuffix(error: unknown, install: InstallInfo): string {
  const swapped = isInstallSwapped(error, install)
    ? ' The server install changed underneath it: reconnect the server (`/mcp` in Claude Code, or restart Codex).'
    : ''
  return `${swapped}\n[${describeInstall(install)}]`
}
