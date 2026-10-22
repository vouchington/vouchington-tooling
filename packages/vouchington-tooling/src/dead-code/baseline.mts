import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const categories = new Set([
  'unused-file',
  'unused-export',
  'unused-symbol',
  'unused-import',
  'unused-member',
])

export type FindingIdentity = {
  category: string
  path: string
  parent: string
  name: string
  symbolKind: string
}

export type BaselineRow = FindingIdentity & { count: number }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Expected ${field} to be a string`)
  return value
}

function identity(value: unknown): FindingIdentity {
  const row = record(value)
  const category = requiredString(row['category'], 'category')
  const path = requiredString(row['path'], 'path')
  const parent = requiredString(row['parent'] ?? '', 'parent')
  const name = requiredString(row['name'], 'name')
  const symbolKind = requiredString(row['symbolKind'] ?? '', 'symbolKind')
  if (!categories.has(category)) throw new Error(`Unknown dead-code category: ${category}`)
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error(`Invalid report path: ${path}`)
  }
  return { category, path, parent, name, symbolKind }
}

function key(row: FindingIdentity): string {
  return JSON.stringify([row.category, row.path, row.parent, row.name, row.symbolKind])
}

function sortedRows(rows: readonly BaselineRow[]): BaselineRow[] {
  return rows.toSorted((a, b) => key(a).localeCompare(key(b), 'en'))
}

export function rowsFromReport(
  value: unknown,
  include: (finding: FindingIdentity, raw: Record<string, unknown>) => boolean = () => true,
): BaselineRow[] {
  const report = record(value)
  const statistics = record(report['statistics'])
  if (!Number.isInteger(statistics['files']) || (statistics['files'] as number) <= 0) {
    throw new Error('Dead-code scan analyzed no files')
  }
  if (statistics['unparsed'] !== 0) {
    throw new Error(`Dead-code scan has unparsed files: ${String(statistics['unparsed'])}`)
  }
  if (!Array.isArray(report['findings'])) throw new Error('Dead-code report has no findings array')
  const counts = new Map<string, BaselineRow>()
  for (const value of report['findings']) {
    const found = identity(value)
    if (!include(found, record(value))) continue
    const id = key(found)
    const existing = counts.get(id)
    counts.set(id, { ...found, count: (existing?.count ?? 0) + 1 })
  }
  return sortedRows([...counts.values()])
}

export function parseBaseline(value: unknown): BaselineRow[] {
  const baseline = record(value)
  if (baseline['version'] !== 1 || !Array.isArray(baseline['findings'])) {
    throw new Error('Invalid dead-code baseline version or findings array')
  }
  const rows = baseline['findings'].map((value) => {
    const item = record(value)
    const found = identity(item)
    if (!Number.isInteger(item['count']) || (item['count'] as number) < 1) {
      throw new Error(`Invalid dead-code baseline count for ${key(found)}`)
    }
    return { ...found, count: item['count'] as number }
  })
  const sorted = sortedRows(rows)
  if (rows.some((row, index) => key(row) !== key(sorted[index]!))) {
    throw new Error('Dead-code baseline is not sorted')
  }
  if (new Set(rows.map(key)).size !== rows.length) {
    throw new Error('Dead-code baseline has duplicate identities')
  }
  return rows
}

export function compareRows(current: readonly BaselineRow[], baseline: readonly BaselineRow[]) {
  const oldCounts = new Map(baseline.map((row) => [key(row), row.count]))
  const newCounts = new Map(current.map((row) => [key(row), row.count]))
  const added = current.filter((row) => row.count > (oldCounts.get(key(row)) ?? 0))
  const stale = baseline.filter((row) => row.count > (newCounts.get(key(row)) ?? 0))
  return { added, stale }
}

export async function readBaseline(path: string): Promise<BaselineRow[]> {
  return parseBaseline(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

export async function writeBaseline(path: string, rows: readonly BaselineRow[]): Promise<void> {
  await writeFile(path, `${JSON.stringify({ version: 1, findings: sortedRows(rows) }, null, 2)}\n`)
}

function describe(rows: readonly BaselineRow[]): string {
  const shown = rows.slice(0, 12).map((row) => {
    const symbol = row.name ? ` ${row.parent ? `${row.parent}.` : ''}${row.name}` : ''
    return `  ${row.category} ${row.path}${symbol} (${row.count})`
  })
  if (rows.length > shown.length) shown.push(`  …and ${rows.length - shown.length} more identities`)
  return shown.join('\n')
}

export async function reconcileBaseline(
  path: string,
  current: readonly BaselineRow[],
  operation: 'check' | 'seed' | 'update',
): Promise<number> {
  if (operation === 'seed') {
    if (existsSync(path)) throw new Error('Initial baseline already exists')
    await writeBaseline(path, current)
    return 0
  }
  const previous = await readBaseline(path)
  const { added, stale } = compareRows(current, previous)
  if (added.length > 0) throw new Error(`New dead-code findings:\n${describe(added)}`)
  if (operation === 'check' && stale.length > 0) {
    throw new Error(`Stale dead-code baseline findings:\n${describe(stale)}`)
  }
  if (operation === 'update' && stale.length > 0) await writeBaseline(path, current)
  return stale.length
}
