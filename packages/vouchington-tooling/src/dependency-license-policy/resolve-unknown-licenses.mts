import { assertCommandSucceeded } from './assert-command.mts'
import type { PnpmExecutor, PnpmLicenseReport, PnpmLicenseReportEntry } from './types.mts'

const UNKNOWN_LICENSE = 'Unknown'
const VIEW_CONCURRENCY = 8

type CommandOptions = Parameters<PnpmExecutor>[2]

/** Reads the license from `pnpm view <spec> license --json` output, or undefined if unusable. */
function parseViewedLicense(stdout: string): string | undefined {
  if (stdout.trim() === '') return undefined
  const value = JSON.parse(stdout) as unknown
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const { type } = value as Record<string, unknown>
    if (typeof type === 'string') return type
  }
  return undefined
}

async function viewLicense(
  execute: PnpmExecutor,
  spec: string,
  options: CommandOptions,
): Promise<string | undefined> {
  const label = `pnpm view ${spec} license --json`
  const result = await execute('pnpm', ['view', spec, 'license', '--json'], options)
  assertCommandSucceeded(label, result)
  try {
    return parseViewedLicense(result.stdout)
  } catch (error) {
    throw new Error(`${label} produced unparseable output: ${String(error)}`, { cause: error })
  }
}

async function runPool<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let failed = false
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++] as T
      try {
        await worker(item)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(VIEW_CONCURRENCY, items.length) }, lane))
}

function addToGroup(
  report: PnpmLicenseReport,
  license: string,
  name: string,
  version: string,
): void {
  const group = (report[license] ??= [])
  const index = group.findIndex((entry) => entry.name === name)
  const existing = group[index]
  if (existing) group[index] = { name, versions: [...(existing.versions ?? []), version] }
  else group.push({ name, versions: [version] })
}

/**
 * Resolves `Unknown` entries from the registry manifest. pnpm reports every package missing from the
 * store, such as off-platform optional packages, as `Unknown`, so each is looked up with
 * `pnpm view`. Entries whose manifest has no usable license stay `Unknown`.
 */
export async function resolveUnknownLicenses(
  report: PnpmLicenseReport,
  execute: PnpmExecutor,
  options: CommandOptions,
): Promise<PnpmLicenseReport> {
  const unknown = report[UNKNOWN_LICENSE]
  if (!unknown) return report
  const targets = unknown.flatMap((entry) =>
    (entry.versions ?? []).map((version) => ({ name: entry.name, version })),
  )
  const resolved = new Map<string, string>()
  await runPool(targets, async ({ name, version }) => {
    const license = await viewLicense(execute, `${name}@${version}`, options)
    if (license !== undefined) resolved.set(`${name}@${version}`, license)
  })
  const remaining: PnpmLicenseReportEntry[] = []
  for (const entry of unknown) {
    const stillUnknown = (entry.versions ?? []).filter((version) => {
      const license = resolved.get(`${entry.name}@${version}`)
      if (license === undefined) return true
      addToGroup(report, license, entry.name, version)
      return false
    })
    if (stillUnknown.length > 0) remaining.push({ name: entry.name, versions: stillUnknown })
    else if (entry.versions === undefined) remaining.push(entry)
  }
  if (remaining.length > 0) report[UNKNOWN_LICENSE] = remaining
  else delete report[UNKNOWN_LICENSE]
  return report
}
