import type { SchemaCatalog } from './catalog-queries.mts'
import { groupBy, keyed } from './snapshot-build-utils.mts'
import { buildTableSnapshots } from './table-snapshot.mts'
import type {
  SchemaEnumSnapshot,
  SchemaExtensionSnapshot,
  SchemaFunctionSnapshot,
  SchemaGrowthMaps,
  SchemaPolicySnapshot,
  SchemaSnapshot,
  SchemaViewSnapshot,
} from './types.mts'

export { buildTableSnapshots } from './table-snapshot.mts'

/**
 * Transforms raw pg_catalog rows into the committed, name-keyed schema snapshot object. Pure —
 * no I/O. Table-specific catalog validation and structured facts live in table-snapshot.mts;
 * this module owns the remaining schema-wide object groups and final deterministic assembly.
 */
export function buildSchemaSnapshot(
  catalog: SchemaCatalog,
  growth: SchemaGrowthMaps,
): SchemaSnapshot {
  const tables = buildTableSnapshots({
    catalog,
    columnsByTable: groupBy(catalog.columns, (row) => row.table_name),
    constraintsByTable: groupBy(catalog.constraints, (row) => row.table_name),
    indexesByTable: groupBy(catalog.indexes, (row) => row.table_name),
    triggersByTable: groupBy(catalog.triggers, (row) => row.table_name),
    growth,
  })
  const enumValuesByName = groupBy(catalog.enums, (row) => row.enum_name)
  const views: Record<string, SchemaViewSnapshot> = {}
  for (const view of catalog.views) {
    views[view.view_name] = {
      definition: view.definition,
      comment: view.comment,
      materialized: view.materialized,
    }
  }
  const enums: Record<string, SchemaEnumSnapshot> = {}
  for (const [enumName, values] of enumValuesByName) {
    enums[enumName] = { values: values.map((value) => value.value) }
  }
  const extensions: Record<string, SchemaExtensionSnapshot> = {}
  for (const extension of catalog.extensions) {
    extensions[extension.extension_name] = { version: extension.version }
  }
  const functions: Record<string, SchemaFunctionSnapshot> = {}
  for (const fn of catalog.functions) {
    const key = fn.identity_arguments
      ? `${fn.function_name}(${fn.identity_arguments})`
      : fn.function_name
    functions[key] = { definition: fn.definition }
  }
  const policies: Record<string, SchemaPolicySnapshot> = {}
  for (const policy of catalog.policies) {
    policies[`${policy.table_name}.${policy.policy_name}`] = {
      table: policy.table_name,
      command: policy.command,
      pgRoles: policy.pg_roles,
      using: policy.using_expression,
      withCheck: policy.with_check_expression,
    }
  }
  return {
    formatVersion: 2,
    tables,
    views: keyed(Object.entries(views)),
    enums: keyed(Object.entries(enums)),
    extensions: keyed(Object.entries(extensions)),
    functions: keyed(Object.entries(functions)),
    policies: keyed(Object.entries(policies)),
  }
}
