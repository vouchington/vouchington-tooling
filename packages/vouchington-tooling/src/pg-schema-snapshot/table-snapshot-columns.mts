import type { CatalogColumnRow } from './catalog-queries.mts'
import type { SchemaColumnSnapshot } from './types.mts'

function toIdentity(code: CatalogColumnRow['identity']): SchemaColumnSnapshot['identity'] {
  if (code === 'a') return 'always'
  if (code === 'd') return 'by default'
  return null
}

function toGenerated(code: CatalogColumnRow['generated']): SchemaColumnSnapshot['generated'] {
  if (code === 's') return 'stored'
  if (code === 'v') return 'virtual'
  return null
}

export function buildTableColumns(rows: CatalogColumnRow[]): Record<string, SchemaColumnSnapshot> {
  const columns: Record<string, SchemaColumnSnapshot> = {}
  for (const column of rows.toSorted(
    (left, right) =>
      left.ordinal_position - right.ordinal_position ||
      left.column_name.localeCompare(right.column_name),
  )) {
    const generated = toGenerated(column.generated)
    columns[column.column_name] = {
      type: column.data_type,
      nullable: column.nullable,
      defaultExpression: generated ? null : column.default_expression,
      generatedExpression: generated ? column.default_expression : null,
      identity: toIdentity(column.identity),
      generated,
      collation: column.collation,
      comment: column.comment,
      ordinalPosition: column.ordinal_position,
    }
  }
  return columns
}
