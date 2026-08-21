import type {
  CatalogIndexRow,
  CatalogTableRow,
  CatalogTriggerRow,
  SchemaCatalog,
} from './catalog-queries.mts'
import { keyed } from './snapshot-build-utils.mts'
import { buildTableColumns } from './table-snapshot-columns.mts'
import { buildTableConstraints } from './table-snapshot-constraints.mts'
import type {
  SchemaGrowthMaps,
  SchemaIndexSnapshot,
  SchemaPhysicalPartitionSnapshot,
  SchemaTableSnapshot,
} from './types.mts'

function physicalPartition({
  partition_key: key,
  partition_strategy: strategy,
}: CatalogTableRow): SchemaPhysicalPartitionSnapshot | null {
  if (strategy === '') return null
  if (!key) throw new Error('A physically partitioned table must have a partition key.')
  if (strategy === 'h') return { strategy: 'hash', key }
  if (strategy === 'l') return { strategy: 'list', key }
  return { strategy: 'range', key }
}

function indexSnapshot(index: CatalogIndexRow): SchemaIndexSnapshot {
  return {
    definition: index.definition,
    accessMethod: index.access_method,
    unique: index.unique,
    primary: index.primary,
    constraintBacked: index.constraint_backed,
    valid: index.valid,
    ready: index.ready,
    keys: index.keys.map((key) => ({
      column: key.column,
      expression: key.expression,
      opclass: key.opclass,
      descending: key.descending,
      nullsFirst: key.nulls_first,
    })),
    includedColumns: index.included_columns,
    predicate: index.predicate,
  }
}

function triggersSnapshot(rows: CatalogTriggerRow[]): Record<string, string> {
  return keyed(rows.map((trigger) => [trigger.trigger_name, trigger.definition]))
}

function assertKnownTableRows(catalog: SchemaCatalog): void {
  const tableNames = new Set(catalog.tables.map((table) => table.table_name))
  const rows = [...catalog.columns, ...catalog.constraints, ...catalog.indexes, ...catalog.triggers]
  for (const row of rows) {
    if (!tableNames.has(row.table_name)) {
      throw new Error(`Catalog row references unknown table "${row.table_name}".`)
    }
  }
}

function assertNoDuplicateNames(
  rows: Array<{ table_name: string } & Record<string, unknown>>,
  name: keyof (typeof rows)[number],
): void {
  const names = new Set<string>()
  for (const row of rows) {
    const key = `${row.table_name}.${String(row[name])}`
    if (names.has(key)) throw new Error(`Catalog contains duplicate ${String(name)} "${key}".`)
    names.add(key)
  }
}

function assertCatalogConsistency(catalog: SchemaCatalog): void {
  assertKnownTableRows(catalog)
  assertNoDuplicateNames(catalog.columns, 'column_name')
  assertNoDuplicateNames(catalog.constraints, 'constraint_name')
  assertNoDuplicateNames(catalog.indexes, 'index_name')
  assertNoDuplicateNames(catalog.triggers, 'trigger_name')
}

export function buildTableSnapshots({
  catalog,
  columnsByTable,
  constraintsByTable,
  indexesByTable,
  triggersByTable,
  growth,
}: {
  catalog: SchemaCatalog
  columnsByTable: Map<string, SchemaCatalog['columns']>
  constraintsByTable: Map<string, SchemaCatalog['constraints']>
  indexesByTable: Map<string, SchemaCatalog['indexes']>
  triggersByTable: Map<string, SchemaCatalog['triggers']>
  growth: SchemaGrowthMaps
}): Record<string, SchemaTableSnapshot> {
  assertCatalogConsistency(catalog)
  const tables: Record<string, SchemaTableSnapshot> = {}
  for (const table of catalog.tables.toSorted((left, right) =>
    left.table_name.localeCompare(right.table_name),
  )) {
    const partition = growth.partitionPolicies.get(table.table_name) ?? null
    if (table.relkind === 'p' && !partition) {
      throw new Error(
        `Table "${table.table_name}" is partitioned (relkind = 'p') but has no partitionPolicies entry. ` +
          'Every partitioned table must be classified.',
      )
    }
    const physical = physicalPartition(table)
    if ((table.relkind === 'p') !== (physical !== null)) {
      throw new Error(
        `Table "${table.table_name}" has inconsistent relation kind and physical partition facts.`,
      )
    }
    const columns = buildTableColumns(columnsByTable.get(table.table_name) ?? [])
    tables[table.table_name] = {
      relationKind: table.relkind === 'p' ? 'partitioned table' : 'table',
      columns,
      ...buildTableConstraints({
        tableName: table.table_name,
        columns,
        constraints: constraintsByTable.get(table.table_name) ?? [],
      }),
      indexes: keyed(
        (indexesByTable.get(table.table_name) ?? []).map((index) => [
          index.index_name,
          indexSnapshot(index),
        ]),
      ),
      triggers: triggersSnapshot(triggersByTable.get(table.table_name) ?? []),
      comment: table.comment,
      physicalPartition: physical,
      partition,
      growth:
        partition || growth.unboundedUnpartitionedTables.has(table.table_name)
          ? 'unbounded'
          : 'bounded',
    }
  }
  return tables
}
