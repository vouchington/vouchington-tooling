import { createClassifier } from './classify.mts'
import type { ClocConfig } from './config.mts'

export type CountedFile = { code: number; path: string }

/** One table row: per-category line counts keyed by the configured category names. */
export type ClocRow = { service: string; counts: Record<string, number>; total: number }

export function buildRows(files: readonly CountedFile[], config: ClocConfig): ClocRow[] {
  const classify = createClassifier(config)
  const names = config.categories
  const blank = (service: string): ClocRow => ({
    service,
    counts: { [names.source]: 0, [names.tests]: 0, [names.tooling]: 0 },
    total: 0,
  })
  const rows = new Map(config.services.map((rule) => [rule.name, blank(rule.name)]))
  const total = blank('total')
  for (const file of files) {
    const { category, service } = classify(file.path)
    const label = names[category]
    for (const target of [rows.get(service) as ClocRow, total]) {
      target.counts[label] = (target.counts[label] ?? 0) + file.code
      target.total += file.code
    }
  }
  return [...rows.values(), total]
}

export function formatRows(rows: readonly ClocRow[], config: ClocConfig): string {
  const { source, tests, tooling } = config.categories
  const columns = ['service', source, tests, tooling, 'total']
  const cell = (row: ClocRow, column: string): string => {
    if (column === 'service') return row.service
    return String(column === 'total' ? row.total : (row.counts[column] ?? 0))
  }
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => cell(row, column).length)),
  )
  const line = (values: string[]): string =>
    values
      .map((value, index) =>
        index === 0 ? value.padEnd(widths[index] ?? 0) : value.padStart(widths[index] ?? 0),
      )
      .join('  ')
  return [
    line(columns),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map((row) => line(columns.map((column) => cell(row, column)))),
  ].join('\n')
}
