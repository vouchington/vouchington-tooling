import { glob, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type ScanConfig = { deadCode?: { entry?: unknown } } & Record<string, unknown>

function invalid(entry: unknown): boolean {
  return (
    typeof entry !== 'string' ||
    entry.length === 0 ||
    entry.startsWith('/') ||
    entry.includes('\\') ||
    entry.split('/').includes('..')
  )
}

async function assertLive(snapshotRoot: string, entries: readonly unknown[]): Promise<string[]> {
  if (entries.length === 0) throw new Error('jscpd deadCode.entry must contain at least one root')
  for (const entry of entries) {
    if (invalid(entry)) throw new Error(`Invalid dead-code entry root: ${String(entry)}`)
    let matches = 0
    for await (const _ of glob(entry as string, { cwd: snapshotRoot })) matches += 1
    if (matches === 0) throw new Error(`Stale dead-code entry root: ${String(entry)}`)
  }
  return [...(entries as string[])]
}

/**
 * Resolves the live entry roots for a snapshot. Roots come from `override` when given,
 * otherwise from the snapshot config's `deadCode.entry`. Every root must be a relative
 * snapshot-internal glob that matches at least one file. An override is written into the
 * snapshot's copy of the config (never the working tree).
 */
export async function resolveEntryRoots(
  snapshotRoot: string,
  configPath: string,
  override?: readonly string[],
): Promise<string[]> {
  const file = join(snapshotRoot, configPath)
  const config = JSON.parse(await readFile(file, 'utf8')) as ScanConfig
  const configured = config?.deadCode?.entry
  if (override === undefined && !Array.isArray(configured)) {
    throw new Error('jscpd deadCode.entry must contain at least one root')
  }
  const entries = await assertLive(snapshotRoot, override ?? (configured as unknown[]))
  if (override !== undefined) {
    config.deadCode = { ...config.deadCode, entry: entries }
    await writeFile(file, `${JSON.stringify(config, null, 2)}\n`)
  }
  return entries
}
