import type { SchemaSnapshot } from '../pg-schema-snapshot/types.mts'
import { classifyRelationalColumn } from './column-classification.mts'
import { appendCatalogFreshness } from './freshness.mts'
import type {
  GeneratedFkAlias,
  GeneratedSelfRootAlias,
  ObservedRelationalColumns,
  RelationalStorageCatalog,
  RelationalStorageOptions,
  ResolvedRelationalStorageCatalog,
  ReviewedKeyCatalog,
} from './relational-storage-types.mts'
import { isKnownColumnType, relationalStorageDiagnostic } from './type-rules.mts'

export type {
  GeneratedFkAlias,
  GeneratedSelfRootAlias,
  RelationalStorageCatalog,
  RelationalStorageOptions,
  ReviewedKeyCatalog,
}

const EMPTY_SET: ReadonlySet<string> = new Set()
const EMPTY_FK_ALIASES: ReadonlyMap<string, GeneratedFkAlias> = new Map()
const EMPTY_SELF_ROOT_ALIASES: ReadonlyMap<string, GeneratedSelfRootAlias> = new Map()

function resolveCatalog(
  catalog: RelationalStorageCatalog | undefined,
): ResolvedRelationalStorageCatalog {
  const allowedNonrelationUuids = catalog?.allowedNonrelationUuids ?? EMPTY_SET
  const allowedTokenCursorProtocolIds = catalog?.allowedTokenCursorProtocolIds
    ? new Set(catalog.allowedTokenCursorProtocolIds.keys())
    : EMPTY_SET
  const allowedAuditSnapshotIds = catalog?.allowedAuditSnapshotIds
    ? new Set(catalog.allowedAuditSnapshotIds.keys())
    : EMPTY_SET
  const extraKnownTypes = catalog?.extraKnownTypes
    ? new Set([...catalog.extraKnownTypes].map((name) => name.toLowerCase().trim()))
    : EMPTY_SET
  return {
    allowedOpaqueJson: catalog?.allowedOpaqueJson ?? EMPTY_SET,
    allowedNonrelationUuids,
    allowedOwnPrimaryUuids: catalog?.allowedOwnPrimaryUuids ?? EMPTY_SET,
    allowedTokenCursorProtocolIds,
    allowedAuditSnapshotIds,
    acceptedUuidReference: new Set([
      ...allowedNonrelationUuids,
      ...allowedTokenCursorProtocolIds,
      ...allowedAuditSnapshotIds,
    ]),
    acceptedEncodedReference: allowedTokenCursorProtocolIds,
    generatedFkAliases: catalog?.generatedFkAliases ?? EMPTY_FK_ALIASES,
    generatedSelfRootAliases: catalog?.generatedSelfRootAliases ?? EMPTY_SELF_ROOT_ALIASES,
    extraEncodedReferenceColumns: catalog?.extraEncodedReferenceColumns ?? EMPTY_SET,
    extraKnownTypes,
  }
}

/**
 * Enforces application-owned relational storage rules against a PostgreSQL schema snapshot using
 * caller-supplied exception and alias catalogs.
 */
export function checkRelationalStorage(
  schema: SchemaSnapshot,
  options: RelationalStorageOptions,
): string[] {
  const catalog = resolveCatalog(options.catalog)
  const errors: string[] = []
  const observed: ObservedRelationalColumns = {
    encodedReference: new Set(),
    json: new Set(),
    missingForeignKey: new Set(),
    ownPrimary: new Set(),
  }

  for (const [tableName, table] of Object.entries(schema.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      const key = `${tableName}.${columnName}`
      const type = column.type.toLowerCase()
      if (!isKnownColumnType(type, schema.enums, catalog.extraKnownTypes)) {
        errors.push(
          relationalStorageDiagnostic(
            options.snapshotPath,
            key,
            `domain-backed type ${column.type} must be resolved to its base type before relational classification`,
          ),
        )
        continue
      }
      if (/^jsonb?(?:\[\])*$/u.test(type)) {
        observed.json.add(key)
      }
      if (/^uuid\[\]$/u.test(type)) {
        errors.push(
          relationalStorageDiagnostic(
            options.snapshotPath,
            key,
            'UUID array relationship needs concrete relational storage',
          ),
        )
      }
      classifyRelationalColumn(
        tableName,
        columnName,
        column,
        table,
        catalog,
        options.snapshotPath,
        observed,
        errors,
      )
    }
  }

  if (options.enforceCatalogFreshness !== false) {
    appendCatalogFreshness(schema, catalog, options.snapshotPath, observed, errors)
  }
  return errors
}
