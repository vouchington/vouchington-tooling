import type {
  SchemaColumnSnapshot,
  SchemaSnapshot,
  SchemaTableSnapshot,
} from '../pg-schema-snapshot/types.mts'
import type {
  ObservedRelationalColumns,
  ResolvedRelationalStorageCatalog,
} from './relational-storage-types.mts'
import { isGeneratedFkAlias, isGeneratedSelfRootAlias } from './generated-aliases.mts'
import { relationalStorageDiagnostic } from './type-rules.mts'

function checkFreshness(
  snapshotPath: string,
  label: string,
  declared: ReadonlySet<string>,
  observed: ReadonlySet<string>,
  errors: string[],
): void {
  for (const key of declared) {
    if (observed.has(key)) continue
    errors.push(
      relationalStorageDiagnostic(snapshotPath, key, `stale ${label} catalog entry; remove it`),
    )
  }
}

function checkDisjoint(
  snapshotPath: string,
  first: ReadonlySet<string>,
  second: ReadonlySet<string>,
  label: string,
  errors: string[],
): void {
  for (const key of first) {
    if (!second.has(key)) continue
    errors.push(relationalStorageDiagnostic(snapshotPath, key, `duplicate ${label} catalog entry`))
  }
}

function lookupColumn(
  schema: SchemaSnapshot,
  key: string,
): {
  tableName: string
  columnName: string
  table: SchemaTableSnapshot
  column: SchemaColumnSnapshot
} | null {
  const parts = key.split('.')
  if (parts.length !== 2) return null
  const [tableName, columnName] = parts
  if (!tableName || !columnName) return null
  const table = Object.hasOwn(schema.tables, tableName) ? schema.tables[tableName] : undefined
  if (table === undefined) return null
  const column = Object.hasOwn(table.columns, columnName) ? table.columns[columnName] : undefined
  if (column === undefined) return null
  return { tableName, columnName, table, column }
}

// Each reviewed id needs an exact live column and no second classification.
function appendReviewedIdFreshness(
  catalog: ResolvedRelationalStorageCatalog,
  snapshotPath: string,
  observed: ObservedRelationalColumns,
  errors: string[],
): void {
  const tokenColumns = new Set([...observed.missingForeignKey, ...observed.encodedReference])
  const tokens = catalog.allowedTokenCursorProtocolIds
  const audits = catalog.allowedAuditSnapshotIds
  checkFreshness(snapshotPath, 'token, cursor or protocol identifier', tokens, tokenColumns, errors)
  checkFreshness(
    snapshotPath,
    'audit snapshot identifier',
    audits,
    observed.missingForeignKey,
    errors,
  )
  for (const reviewed of [tokens, audits]) {
    checkDisjoint(
      snapshotPath,
      reviewed,
      catalog.allowedNonrelationUuids,
      'reviewed identifier',
      errors,
    )
  }
  checkDisjoint(snapshotPath, tokens, audits, 'reviewed identifier', errors)
}

export function appendCatalogFreshness(
  schema: SchemaSnapshot,
  catalog: ResolvedRelationalStorageCatalog,
  snapshotPath: string,
  observed: ObservedRelationalColumns,
  errors: string[],
): void {
  checkFreshness(snapshotPath, 'opaque JSON', catalog.allowedOpaqueJson, observed.json, errors)
  checkFreshness(
    snapshotPath,
    'nonrelationship UUID',
    catalog.allowedNonrelationUuids,
    observed.missingForeignKey,
    errors,
  )
  checkFreshness(
    snapshotPath,
    'own primary UUID',
    catalog.allowedOwnPrimaryUuids,
    observed.ownPrimary,
    errors,
  )
  appendReviewedIdFreshness(catalog, snapshotPath, observed, errors)
  for (const [key, alias] of catalog.generatedFkAliases) {
    const found = lookupColumn(schema, key)
    if (found && isGeneratedFkAlias(found.table, found.column.generatedExpression, alias)) continue
    errors.push(
      relationalStorageDiagnostic(
        snapshotPath,
        key,
        `stale or invalid generated FK alias catalog entry: ${alias.expression}; ${alias.oneTargetCheck}`,
      ),
    )
  }
  for (const [key, alias] of catalog.generatedSelfRootAliases) {
    const found = lookupColumn(schema, key)
    if (
      found &&
      isGeneratedSelfRootAlias(
        found.tableName,
        found.table,
        found.columnName,
        found.column.generatedExpression,
        alias,
      )
    ) {
      continue
    }
    errors.push(
      relationalStorageDiagnostic(
        snapshotPath,
        key,
        `stale or invalid generated self-root alias catalog entry: ${alias.expression}`,
      ),
    )
  }
}
