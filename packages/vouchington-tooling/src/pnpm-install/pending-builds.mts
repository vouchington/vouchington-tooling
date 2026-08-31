import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parse, stringify } from 'yaml'

export type PendingBuilds = { kind: 'known'; ids: Set<string> } | { kind: 'unknown' }
export type PendingBuildDelta =
  | { kind: 'unknown' }
  | { kind: 'known'; dependencyIds: string[]; workspaceIds: string[] }

export async function pendingBuilds(): Promise<PendingBuilds> {
  try {
    const value: unknown = parse(
      await readFile(path.join(process.cwd(), 'node_modules', '.modules.yaml'), 'utf8'),
    )
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return { kind: 'unknown' }
    const pending = (value as Record<string, unknown>).pendingBuilds ?? []
    if (!Array.isArray(pending) || !pending.every((id) => typeof id === 'string'))
      return { kind: 'unknown' }
    return { kind: 'known', ids: new Set(pending) }
  } catch {
    return { kind: 'unknown' }
  }
}

export async function ignoredBuildsAreClean() {
  try {
    const value: unknown = parse(
      await readFile(path.join(process.cwd(), 'node_modules', '.modules.yaml'), 'utf8'),
    )
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const ignored = (value as Record<string, unknown>).ignoredBuilds
    return (
      Array.isArray(ignored) &&
      ignored.length === 0 &&
      ignored.every((id) => typeof id === 'string')
    )
  } catch {
    return false
  }
}

async function lockfileDependencyIds() {
  try {
    const lockfile: unknown = parse(
      await readFile(path.join(process.cwd(), 'pnpm-lock.yaml'), 'utf8'),
    )
    if (typeof lockfile !== 'object' || lockfile === null || !('packages' in lockfile))
      return undefined
    const packages = lockfile.packages
    if (typeof packages !== 'object' || packages === null || Array.isArray(packages))
      return undefined
    return new Set(Object.keys(packages))
  } catch {
    return undefined
  }
}

export async function validDependencyBuildIds(ids: [string, ...string[]]) {
  const packages = await lockfileDependencyIds()
  if (!packages || !ids.every((id) => packages.has(id))) return undefined
  const [first, ...remaining] = ids.toSorted()
  return [first, ...remaining] as [string, ...string[]]
}

export async function clearPendingDependencyBuilds(ids: string[]) {
  const filename = path.join(process.cwd(), 'node_modules', '.modules.yaml')
  try {
    const value: unknown = parse(await readFile(filename, 'utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const record = value as Record<string, unknown>
    if (
      !Array.isArray(record.pendingBuilds) ||
      !record.pendingBuilds.every((id) => typeof id === 'string')
    )
      return false
    const ignored = record.ignoredBuilds ?? []
    if (
      !Array.isArray(ignored) ||
      !ignored.every((id) => typeof id === 'string') ||
      ids.some((id) => ignored.includes(id))
    )
      return false
    record.pendingBuilds = record.pendingBuilds.filter((id) => !ids.includes(id))
    const temporary = `${filename}.${process.pid}.tmp`
    try {
      await writeFile(temporary, stringify(record))
      await rename(temporary, filename)
    } finally {
      await rm(temporary, { force: true })
    }
    return true
  } catch {
    return false
  }
}

export async function pendingBuildDelta(
  before: PendingBuilds,
  after: PendingBuilds,
): Promise<PendingBuildDelta> {
  if (before.kind !== 'known' || after.kind !== 'known') return { kind: 'unknown' }
  const packages = await lockfileDependencyIds()
  if (!packages) return { kind: 'unknown' }
  const dependencyIds: string[] = []
  const workspaceIds: string[] = []
  for (const id of after.ids) {
    if (before.ids.has(id)) continue
    ;(packages.has(id) ? dependencyIds : workspaceIds).push(id)
  }
  return {
    kind: 'known',
    dependencyIds: dependencyIds.toSorted(),
    workspaceIds: workspaceIds.toSorted(),
  }
}
