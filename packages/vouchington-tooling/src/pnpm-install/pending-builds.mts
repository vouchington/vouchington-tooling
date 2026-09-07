import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parse, stringify } from 'yaml'

import { classifyPendingBuildIds } from './pending-build-classification.mts'

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

async function buildLedgers(): Promise<BuildLedgers> {
  try {
    const value: unknown = parse(await readFile(modulesPath(), 'utf8'))
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
      record,
    }
  } catch {
    return undefined
  }
}

export async function pendingBuilds(): Promise<PendingBuildState> {
  return (await buildLedgers())?.pendingBuilds ?? { kind: 'unknown' }
}

export async function deduplicatePendingBuilds(): Promise<PendingBuildState> {
  const ledgers = await buildLedgers()
  if (ledgers === undefined || ledgers.pendingBuilds.kind !== 'pending')
    return ledgers?.pendingBuilds ?? { kind: 'unknown' }
  // `buildLedgers` has already verified every pending entry is a string.
  const unique = [...new Set(ledgers.record.pendingBuilds as string[])]
  if (unique.length === ledgers.pendingBuilds.ids.length) return ledgers.pendingBuilds
  try {
    await writeFile(modulesPath(), stringify({ ...ledgers.record, pendingBuilds: unique }))
  } catch {
    return { kind: 'unknown' }
  }
  return pendingBuilds()
}

export async function pruneStalePendingBuilds(): Promise<PendingBuildState> {
  const ledgers = await buildLedgers()
  if (ledgers === undefined || ledgers.pendingBuilds.kind !== 'pending')
    return ledgers?.pendingBuilds ?? { kind: 'unknown' }
  const classification = await classifyPendingBuildIds(ledgers.pendingBuilds.ids)
  if (classification === undefined) return { kind: 'unknown' }
  if (classification.stale.length === 0) return ledgers.pendingBuilds
  try {
    await writeFile(
      modulesPath(),
      stringify({ ...ledgers.record, pendingBuilds: classification.current }),
    )
  } catch {
    return { kind: 'unknown' }
  }
  console.warn(
    `pnpm-install: pruned stale pending build IDs absent from lockfile and package tree: ${classification.stale.join(', ')}`,
  )
  return pendingBuilds()
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
