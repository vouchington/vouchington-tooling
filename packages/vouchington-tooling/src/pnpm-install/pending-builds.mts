import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parse, stringify } from 'yaml'

export type PendingBuildState =
  | { kind: 'clear' }
  | { ids: string[]; kind: 'pending' }
  | { kind: 'unknown' }

type BuildLedgers =
  | {
      ignoredBuilds: string[] | undefined
      pendingBuilds: PendingBuildState
      record: Record<string, unknown>
    }
  | undefined

const modulesPath = () => path.join(process.cwd(), 'node_modules', '.modules.yaml')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function buildLedgers(): Promise<BuildLedgers> {
  try {
    const value: unknown = parse(await readFile(modulesPath(), 'utf8'))
    if (!isRecord(value)) return undefined
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
      record,
    }
  } catch {
    return undefined
  }
}

export async function pendingBuilds(): Promise<PendingBuildState> {
  return (await buildLedgers())?.pendingBuilds ?? { kind: 'unknown' }
}

async function currentBuildIds() {
  try {
    const lockfile: unknown = parse(
      await readFile(path.join(process.cwd(), 'pnpm-lock.yaml'), 'utf8'),
    )
    if (!isRecord(lockfile) || !isRecord(lockfile.importers) || !isRecord(lockfile.packages))
      return undefined
    return new Set([...Object.keys(lockfile.importers), ...Object.keys(lockfile.packages)])
  } catch {
    return undefined
  }
}

async function rewritePendingBuilds(
  record: Record<string, unknown>,
  originalLength: number,
  ids: string[],
): Promise<PendingBuildState> {
  if (ids.length === originalLength)
    return ids.length === 0 ? { kind: 'clear' } : { ids: ids.toSorted(), kind: 'pending' }
  try {
    await writeFile(modulesPath(), stringify({ ...record, pendingBuilds: ids }))
  } catch {
    return { kind: 'unknown' }
  }
  return pendingBuilds()
}

export async function deduplicatePendingBuilds(): Promise<PendingBuildState> {
  const ledgers = await buildLedgers()
  if (ledgers === undefined || ledgers.pendingBuilds.kind !== 'pending')
    return ledgers?.pendingBuilds ?? { kind: 'unknown' }
  // `buildLedgers` has already verified every pending entry is a string.
  const unique = [...new Set(ledgers.record.pendingBuilds as string[])]
  return rewritePendingBuilds(ledgers.record, ledgers.pendingBuilds.ids.length, unique)
}

export async function pruneStalePendingBuilds(): Promise<PendingBuildState> {
  const ledgers = await buildLedgers()
  if (ledgers === undefined || ledgers.pendingBuilds.kind !== 'pending')
    return ledgers?.pendingBuilds ?? { kind: 'unknown' }
  const current = await currentBuildIds()
  if (current === undefined) return { kind: 'unknown' }
  return rewritePendingBuilds(
    ledgers.record,
    ledgers.pendingBuilds.ids.length,
    ledgers.pendingBuilds.ids.filter((id) => current.has(id)),
  )
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
