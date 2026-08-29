import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

export type PendingBuilds = { kind: 'known'; ids: Set<string> } | { kind: 'unknown' }

export async function pendingBuilds(): Promise<PendingBuilds> {
  try {
    const value: unknown = parse(
      await readFile(path.join(process.cwd(), 'node_modules', '.modules.yaml'), 'utf8'),
    )
    if (
      typeof value !== 'object' ||
      value === null ||
      !('pendingBuilds' in value) ||
      !Array.isArray(value.pendingBuilds) ||
      !value.pendingBuilds.every((id) => typeof id === 'string')
    )
      return { kind: 'unknown' }
    return { kind: 'known', ids: new Set(value.pendingBuilds) }
  } catch {
    return { kind: 'unknown' }
  }
}

export function hasNewPendingBuilds(before: PendingBuilds, after: PendingBuilds) {
  return (
    before.kind !== 'known' ||
    after.kind !== 'known' ||
    [...after.ids].some((id) => !before.ids.has(id))
  )
}
