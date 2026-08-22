import { parse as parseSync } from 'csv-parse/sync'
import { stringify } from 'csv-stringify'
import type { Transform } from 'node:stream'

const SPREADSHEET_FORMULA_PREFIX = /^[=+\-@\t\r]/u

export function stripCsvBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function parseCsvRows(csvText: string): Record<string, string>[] {
  return parseSync(stripCsvBom(csvText), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
  }) as Record<string, string>[]
}

export function escapeSpreadsheetFormula(value: string | null | undefined): string {
  if (value == null) return ''
  return SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value
}

export function streamCsvRows(
  rows: readonly Readonly<Record<string, string | null | undefined>>[],
  columns: readonly string[],
): Transform {
  const stringifier = stringify({ header: true, columns: [...columns] })
  stringifier.on('error', (error) => stringifier.destroy(error))
  for (const row of rows) {
    const escaped: Record<string, string> = {}
    for (const key of columns) escaped[key] = escapeSpreadsheetFormula(row[key])
    stringifier.write(escaped)
  }
  stringifier.end()
  return stringifier
}
