import type { SchemaColumnSnapshot, SchemaTableSnapshot } from '../pg-schema-snapshot/types.mts'
import type {
  ObservedRelationalColumns,
  ResolvedRelationalStorageCatalog,
} from './relational-storage-types.mts'
import { isGeneratedAlias } from './generated-aliases.mts'
import {
  ENCODED_KEY_NAME,
  coveredByForeignKey,
  isEncodedText,
  isIndependentlyGenerated,
  isSolePrimaryKey,
  relationalStorageDiagnostic,
  typeBase,
} from './type-rules.mts'

function checkCategory(
  snapshotPath: string,
  key: string,
  kind: string,
  accepted: ReadonlySet<string>,
  observed: Set<string>,
  errors: string[],
): void {
  observed.add(key)
  if (accepted.has(key)) return
  errors.push(
    relationalStorageDiagnostic(
      snapshotPath,
      key,
      `${kind} needs concrete relational storage or an exact reviewed exception`,
    ),
  )
}

export function classifyRelationalColumn(
  tableName: string,
  columnName: string,
  column: SchemaColumnSnapshot,
  table: SchemaTableSnapshot,
  catalog: ResolvedRelationalStorageCatalog,
  snapshotPath: string,
  observed: ObservedRelationalColumns,
  errors: string[],
): void {
  const key = `${tableName}.${columnName}`
  const type = column.type.toLowerCase()
  if (
    typeBase(type) === 'uuid' &&
    columnName === 'id' &&
    isSolePrimaryKey(table, columnName) &&
    !isIndependentlyGenerated(column) &&
    !coveredByForeignKey(table, columnName)
  ) {
    checkCategory(
      snapshotPath,
      key,
      'shared primary key without a target foreign key',
      catalog.allowedOwnPrimaryUuids,
      observed.ownPrimary,
      errors,
    )
  }
  if (
    typeBase(type) === 'uuid' &&
    ENCODED_KEY_NAME.test(columnName) &&
    !coveredByForeignKey(table, columnName)
  ) {
    checkCategory(
      snapshotPath,
      key,
      'UUID reference without a target foreign key',
      catalog.acceptedUuidReference,
      observed.missingForeignKey,
      errors,
    )
  }
  if (
    type === 'uuid' &&
    columnName !== 'id' &&
    (columnName.endsWith('_id') || columnName.endsWith('_uuid')) &&
    !coveredByForeignKey(table, columnName) &&
    !isGeneratedAlias(tableName, table, columnName, column.generatedExpression, catalog)
  ) {
    checkCategory(
      snapshotPath,
      key,
      'UUID reference without a target foreign key',
      catalog.acceptedUuidReference,
      observed.missingForeignKey,
      errors,
    )
  }
  if (
    (columnName === 'uuid_value' &&
      Object.hasOwn(table.columns, 'kind') &&
      !coveredByForeignKey(table, columnName)) ||
    (ENCODED_KEY_NAME.test(columnName) && isEncodedText(type)) ||
    catalog.extraEncodedReferenceColumns.has(key)
  ) {
    checkCategory(
      snapshotPath,
      key,
      'encoded entity reference',
      catalog.acceptedEncodedReference,
      observed.encodedReference,
      errors,
    )
  }
}
