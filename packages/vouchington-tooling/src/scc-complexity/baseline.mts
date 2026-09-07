import type {
  SccComplexityBaseline,
  SccComplexityBaselineEntry,
  SccComplexityScope,
  SccComplexityValue,
} from './types.mts'

export const SCC_COMPLEXITY_BASELINE_VERSION = 1 as const

export function parseSccComplexityBaseline(json: string): SccComplexityBaseline {
  const parsed = JSON.parse(json) as unknown
  if (!isRecord(parsed)) throw new Error('baseline must be an object')
  if (parsed.version !== SCC_COMPLEXITY_BASELINE_VERSION)
    throw new Error(`baseline version must be ${SCC_COMPLEXITY_BASELINE_VERSION}`)
  if (!Array.isArray(parsed.entries)) throw new Error('baseline entries must be an array')

  const entries = parsed.entries.map(parseEntry)
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = baselineKey(entry)
    if (seen.has(key)) throw new Error(`baseline entry ${key} is duplicated`)
    seen.add(key)
  }
  return { entries, version: SCC_COMPLEXITY_BASELINE_VERSION }
}

export function validateSccComplexityBaseline(
  baseline: SccComplexityBaseline,
  scopes: readonly SccComplexityScope[],
  trackedFileSet: ReadonlySet<string>,
  valuesByScope: ReadonlyMap<string, readonly SccComplexityValue[]>,
): void {
  const scopeByName = new Map(scopes.map((scope) => [scope.name, scope]))
  const allFiles = new Set<string>()
  for (const values of valuesByScope.values()) {
    for (const value of values) allFiles.add(value.file)
  }

  for (const entry of baseline.entries) {
    const key = baselineKey(entry)
    const scope = scopeByName.get(entry.scope)
    if (!scope) throw new Error(`baseline entry ${key} is out of scope`)
    if (!trackedFileSet.has(entry.file)) throw new Error(`baseline entry ${key} is untracked`)
    if (
      !scope.includePaths.some(
        (path) =>
          path === '.' ||
          entry.file === path ||
          entry.file.startsWith(`${path.replace(/\/$/, '')}/`),
      )
    )
      throw new Error(`baseline entry ${key} is out of scope`)
    const value = valuesByScope.get(scope.name)?.find((item) => item.file === entry.file)
    if (!value) {
      if (allFiles.has(entry.file)) throw new Error(`baseline entry ${key} is out of scope`)
      throw new Error(`baseline entry ${key} is stale`)
    }
    if (value.complexity <= (scope.limit ?? 50)) throw new Error(`baseline entry ${key} is stale`)
  }
}

export function baselineEntryByScopeAndFile(
  baseline: SccComplexityBaseline | undefined,
): ReadonlyMap<string, SccComplexityBaselineEntry> {
  return new Map(baseline?.entries.map((entry) => [baselineKey(entry), entry]))
}

export function baselineKey({
  file,
  scope,
}: Pick<SccComplexityBaselineEntry, 'file' | 'scope'>): string {
  return `${scope}:${file}`
}

function parseEntry(value: unknown, index: number): SccComplexityBaselineEntry {
  if (!isRecord(value)) throw new Error(`baseline entry ${index} must be an object`)
  if (typeof value.scope !== 'string' || value.scope.length === 0)
    throw new Error(`baseline entry ${index} has an invalid scope`)
  if (typeof value.file !== 'string' || value.file.length === 0)
    throw new Error(`baseline entry ${index} has an invalid file`)
  if (typeof value.complexity !== 'number' || !Number.isFinite(value.complexity))
    throw new Error(`baseline entry ${index} has an invalid complexity`)
  return { complexity: value.complexity, file: value.file, scope: value.scope }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
