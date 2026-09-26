import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const LICENSE_AUDIT_DIRECTORY_PREFIX = 'dependency-license-audit-'
const LICENSE_AUDIT_PID_FILE = 'audit.pid'
const STALE_AUDIT_GRACE_MS = 60_000
const OWNER_START_SLACK_MS = 1_000
const MAX_PID = 2_147_483_647

export interface LicenseAuditReclaimOptions {
  readonly graceMs?: number
  readonly isOwnerAlive?: (pid: number, directoryMtimeMs: number) => boolean
  readonly now?: number
}

export interface LicenseAuditWorkspaceOptions extends LicenseAuditReclaimOptions {
  readonly directory?: string
  readonly pid?: number
}

interface OwnerAliveDependencies {
  readonly isProcessAlive?: (pid: number) => boolean
  readonly readProcessStartMs?: (pid: number) => number | undefined
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

/** Parses `ps -o lstart=` output. Exported for tests of unparseable dates. */
export function parseProcessStart(stdout: string): number | undefined {
  const parsed = Date.parse(stdout.trim())
  if (Number.isNaN(parsed)) return undefined
  return parsed
}

export function readProcessStartMs(pid: number): number | undefined {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' })
  if (result.status !== 0) return undefined
  return parseProcessStart(result.stdout)
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PID) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !hasCode(error, 'ESRCH')
  }
}

/**
 * A directory still belongs to its creator when that PID is alive and the process started
 * before the directory. A recycled PID belongs to a newer process and is not the owner.
 */
export function isAuditOwnerAlive(
  pid: number,
  directoryMtimeMs: number,
  dependencies: OwnerAliveDependencies = {},
): boolean {
  if (!(dependencies.isProcessAlive ?? isProcessAlive)(pid)) return false
  const started = (dependencies.readProcessStartMs ?? readProcessStartMs)(pid)
  if (started === undefined) return true
  return started <= directoryMtimeMs + OWNER_START_SLACK_MS
}

export function writeAuditPid(directory: string, pid = process.pid): void {
  const path = join(directory, LICENSE_AUDIT_PID_FILE)
  writeFileSync(path, `${String(pid)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function readAuditPid(directory: string): number | undefined {
  try {
    const text = readFileSync(join(directory, LICENSE_AUDIT_PID_FILE), 'utf8').trim()
    if (!/^[1-9]\d*$/.test(text)) return undefined
    const pid = Number.parseInt(text, 10)
    return Number.isSafeInteger(pid) && pid <= MAX_PID ? pid : undefined
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  }
}

export function removeAuditDirectory(directory: string): void {
  const stat = lstatSync(directory, { throwIfNoEntry: false })
  if (!stat) return
  if (stat.isSymbolicLink()) {
    unlinkSync(directory)
    return
  }
  if (!stat.isDirectory()) return
  rmSync(directory, { force: true, recursive: true })
}

function reclaimNames(directory: string): string[] {
  try {
    return readdirSync(directory, { encoding: 'utf8' })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return []
    throw error
  }
}

function shouldRemoveAuditDirectory(
  directory: string,
  mtimeMs: number,
  now: number,
  graceMs: number,
  isOwnerAlive: (pid: number, directoryMtimeMs: number) => boolean,
): boolean {
  const pid = readAuditPid(directory)
  if (pid === undefined) return now - mtimeMs >= graceMs
  return !isOwnerAlive(pid, mtimeMs)
}

/** Deletes leftover audit directories whose owner process is gone, including after SIGKILL. */
export function reclaimStaleLicenseAuditDirectories(
  directory: string,
  options: LicenseAuditReclaimOptions = {},
): void {
  const now = options.now ?? Date.now()
  const graceMs = options.graceMs ?? STALE_AUDIT_GRACE_MS
  const isOwnerAlive = options.isOwnerAlive ?? isAuditOwnerAlive
  for (const name of reclaimNames(directory)) {
    if (!name.startsWith(LICENSE_AUDIT_DIRECTORY_PREFIX)) continue
    const path = join(directory, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      unlinkSync(path)
      continue
    }
    if (!stat.isDirectory()) continue
    if (shouldRemoveAuditDirectory(path, stat.mtimeMs, now, graceMs, isOwnerAlive)) {
      rmSync(path, { force: true, recursive: true })
    }
  }
}
