import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

type Lockfile = { importers?: Record<string, unknown>; packages?: Record<string, unknown> }

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

async function lockfileIds(root: string) {
  const lockfile = record(parse(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'))) as
    | Lockfile
    | undefined
  const packages = lockfile === undefined ? undefined : record(lockfile.packages)
  const importers = lockfile === undefined ? undefined : record(lockfile.importers)
  if (packages === undefined || importers === undefined) return undefined
  return new Set([...Object.keys(packages), ...Object.keys(importers)])
}

async function installedPackageIds(directory: string, ids: Set<string>) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await installedPackageIds(child, ids)
      continue
    }
    if (entry.name !== 'package.json' || !entry.isFile()) continue
    const manifest = record(JSON.parse(await readFile(child, 'utf8')))
    if (typeof manifest?.name !== 'string' || typeof manifest.version !== 'string')
      throw new Error('installed package manifest is malformed')
    ids.add(`${manifest.name}@${manifest.version}`)
  }
}

async function packageTreeIds(root: string) {
  const ids = new Set<string>()
  await installedPackageIds(path.join(root, 'node_modules'), ids)
  return ids
}

/**
 * An ID is stale only when the live lockfile and installed package tree both prove it absent.
 * Any unreadable graph or package metadata leaves the classification unknown and fails closed.
 */
export async function classifyPendingBuildIds(ids: string[]) {
  try {
    const root = process.cwd()
    const [lockfile, packageTree] = await Promise.all([lockfileIds(root), packageTreeIds(root)])
    if (lockfile === undefined) return undefined
    const current = ids.filter(
      (id) =>
        packageTree.has(id) ||
        [...lockfile].some((lockfileId) => lockfileId === id || lockfileId.startsWith(`${id}(`)),
    )
    return { current, stale: ids.filter((id) => !current.includes(id)) }
  } catch {
    return undefined
  }
}
