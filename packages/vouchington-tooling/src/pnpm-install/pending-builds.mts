import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'yaml'

export type PendingBuildState =
  | { kind: 'clear' }
  | { ids: string[]; kind: 'pending' }
  | { kind: 'unknown' }

type BuildLedgers =
  | { ignoredBuilds: string[] | undefined; pendingBuilds: PendingBuildState }
  | undefined

async function buildLedgers(): Promise<BuildLedgers> {
  try {
    const value: unknown = parse(
      await readFile(path.join(process.cwd(), 'node_modules', '.modules.yaml'), 'utf8'),
    )
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- validate the parsed YAML object before reading its fields
    const record = value as Record<string, unknown>
    const ignored = Object.hasOwn(record, 'ignoredBuilds') ? record.ignoredBuilds : undefined
    const pending = Object.hasOwn(record, 'pendingBuilds') ? record.pendingBuilds : []
    if (
      (ignored !== undefined &&
        (!Array.isArray(ignored) || !ignored.every((id) => typeof id === 'string'))) ||
      !Array.isArray(pending) ||
      !pending.every((id) => typeof id === 'string')
    )
      return undefined
    return {
      ignoredBuilds: ignored,
      pendingBuilds:
        pending.length === 0 ? { kind: 'clear' } : { ids: pending.toSorted(), kind: 'pending' },
    }
  } catch {
    return undefined
  }
}

export async function pendingBuilds(): Promise<PendingBuildState> {
  return (await buildLedgers())?.pendingBuilds ?? { kind: 'unknown' }
}

export async function buildLedgersAllowNativeRepair() {
  const ledgers = await buildLedgers()
  return (
    ledgers !== undefined &&
    ledgers.ignoredBuilds !== undefined &&
    ledgers.ignoredBuilds.length === 0 &&
    ledgers.pendingBuilds.kind === 'clear'
  )
}
