import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

type Lockfile = {
  importers?: Record<string, unknown>
  packages?: Record<string, unknown>
  snapshots?: Record<string, unknown>
}

const pnpmTemporaryPackageDirectory = /^.+_tmp_\d+_\d+$/

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

async function lockfileIds(root: string) {
  const lockfile = record(parse(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'))) as
    | Lockfile
    | undefined
  if (lockfile === undefined) return undefined
  const packages = record(lockfile.packages)
  const importers = record(lockfile.importers)
  if (packages === undefined || importers === undefined) return undefined
  const snapshots = lockfile.snapshots === undefined ? {} : record(lockfile.snapshots)
  if (snapshots === undefined) return undefined
  return new Set([...Object.keys(packages), ...Object.keys(importers), ...Object.keys(snapshots)])
}

async function packageRootId(directory: string, ids: Set<string>) {
  const manifest = record(JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')))
  if (typeof manifest?.name !== 'string' || typeof manifest.version !== 'string')
    throw new Error('installed package manifest is malformed')
  ids.add(`${manifest.name}@${manifest.version}`)
}

async function installedPackageIds(directory: string, ids: Set<string>) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name === '.bin' ||
      pnpmTemporaryPackageDirectory.test(entry.name)
    )
      continue
    const child = path.join(directory, entry.name)
    if (entry.name.startsWith('@')) await installedPackageIds(child, ids)
    else await packageRootId(child, ids)
  }
}

async function packageTreeIds(root: string) {
  const ids = new Set<string>()
  const nodeModules = path.join(root, 'node_modules')
  const entries = await readdir(nodeModules, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const child = path.join(nodeModules, entry.name)
    if (entry.name === '.pnpm') {
      for (const store of await readdir(child, { withFileTypes: true })) {
        if (store.isDirectory() && store.name !== 'node_modules')
          await installedPackageIds(path.join(child, store.name, 'node_modules'), ids)
      }
    } else if (!entry.name.startsWith('.')) {
      if (entry.name.startsWith('@')) await installedPackageIds(child, ids)
      else await packageRootId(child, ids)
    }
  }
  return ids
}

function packageBaseId(id: string) {
  const peerSuffix = id.indexOf('(')
  return peerSuffix === -1 ? id : id.slice(0, peerSuffix)
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
        packageTree.has(packageBaseId(id)) ||
        [...lockfile].some((lockfileId) => packageBaseId(lockfileId) === packageBaseId(id)),
    )
    return { current, stale: ids.filter((id) => !current.includes(id)) }
  } catch {
    return undefined
  }
}
