import type { SchemaColumnSnapshot, SchemaTableSnapshot } from './types.mts'

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`
}

function renderPartitionLine(table: SchemaTableSnapshot): string {
  if (!table.partition) return `Not partitioned — growth: ${table.growth}.`
  const { strategy, key, children, retentionOwner, accessClass } = table.partition
  const retention = retentionOwner ? `retention owner \`${retentionOwner}\`` : 'no retention owner'
  return `${strategy} partitioned on \`${key}\` (children: ${children}, ${retention}, access class: ${accessClass}, growth: ${table.growth}).`
}

function oneLine(value: string): string {
  return value.replaceAll(/\r?\n/g, ' ')
}

function renderColumnRow(name: string, column: SchemaColumnSnapshot): string {
  const defaultValue = column.generatedExpression ?? column.defaultExpression
  const cells = [
    `\`${name}\``,
    `\`${column.type}\``,
    column.nullable ? 'yes' : 'no',
    defaultValue ? `\`${oneLine(defaultValue)}\`` : '',
    column.identity ?? '',
    column.generated ?? '',
    column.collation ?? '',
    column.comment ? oneLine(column.comment) : '',
  ]
  return `| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`
}

function renderNamedDefinitionList(
  entries: Record<string, string | { definition: string }>,
  emptyText: string,
): string[] {
  const names = Object.keys(entries).toSorted((left, right) => left.localeCompare(right))
  if (names.length === 0) return [emptyText]
  return names.map((name) => {
    const entry = entries[name]!
    return `- \`${name}\`: \`${typeof entry === 'string' ? entry : entry.definition}\``
  })
}

export function renderTableDocument(name: string, table: SchemaTableSnapshot): string {
  const lines: string[] = [
    heading(1, `Table \`${name}\``),
    '',
    'Generated schema snapshot. Do not hand-edit. [Schema index](../README.md).',
  ]
  if (table.comment) lines.push('', table.comment)
  lines.push('', renderPartitionLine(table))

  const columnNames = Object.keys(table.columns).toSorted(
    (left, right) => table.columns[left]!.ordinalPosition - table.columns[right]!.ordinalPosition,
  )
  lines.push(
    '',
    '| Column | Type | Nullable | Default | Identity | Generated | Collation | Comment |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...columnNames.map((columnName) => renderColumnRow(columnName, table.columns[columnName]!)),
  )
  lines.push(
    '',
    `**Primary key:** ${table.primaryKey ? `\`${table.primaryKey.definition}\`` : '_none_'}`,
  )
  lines.push(
    '',
    '**Unique constraints:**',
    ...renderNamedDefinitionList(table.uniqueConstraints, '_none_'),
  )
  lines.push(
    '',
    '**Check constraints:**',
    ...renderNamedDefinitionList(table.checkConstraints, '_none_'),
  )
  lines.push('', '**Foreign keys:**', ...renderNamedDefinitionList(table.foreignKeys, '_none_'))
  lines.push('', '**Indexes:**', ...renderNamedDefinitionList(table.indexes, '_none_'))
  lines.push('', '**Triggers:**', ...renderNamedDefinitionList(table.triggers, '_none_'))
  return `${lines.join('\n')}\n`
}
