/* v8 ignore start -- catalog query helpers require a live database */
import {
  type CatalogEnumValueRow,
  type CatalogExtensionRow,
  type CatalogFunctionRow,
  type CatalogPolicyRow,
  type CatalogViewRow,
  readEnums,
  readExtensions,
  readFunctions,
  readPolicies,
  readViews,
} from './catalog-objects.mts'
import { type CatalogConstraintRow, readConstraints } from './catalog-table-constraints.mts'
import {
  type CatalogIndexRow,
  type CatalogTriggerRow,
  readIndexes,
  readTriggers,
} from './catalog-table-indexes.mts'
import {
  type CatalogColumnRow,
  type CatalogTableRow,
  readColumns,
  readTables,
} from './catalog-tables.mts'
import type { CatalogQuery } from './types.mts'

export {
  readColumns,
  readConstraints,
  readEnums,
  readExtensions,
  readFunctions,
  readIndexes,
  readPolicies,
  readTables,
  readTriggers,
  readViews,
}
export type {
  CatalogColumnRow,
  CatalogConstraintRow,
  CatalogEnumValueRow,
  CatalogExtensionRow,
  CatalogFunctionRow,
  CatalogIndexRow,
  CatalogPolicyRow,
  CatalogTableRow,
  CatalogTriggerRow,
  CatalogViewRow,
}

export type SchemaCatalog = {
  tables: CatalogTableRow[]
  columns: CatalogColumnRow[]
  constraints: CatalogConstraintRow[]
  indexes: CatalogIndexRow[]
  triggers: CatalogTriggerRow[]
  enums: CatalogEnumValueRow[]
  views: CatalogViewRow[]
  extensions: CatalogExtensionRow[]
  functions: CatalogFunctionRow[]
  policies: CatalogPolicyRow[]
}

export async function readSchemaCatalog(query: CatalogQuery): Promise<SchemaCatalog> {
  const [
    tables,
    columns,
    constraints,
    indexes,
    triggers,
    enums,
    views,
    extensions,
    functions,
    policies,
  ] = await Promise.all([
    readTables(query),
    readColumns(query),
    readConstraints(query),
    readIndexes(query),
    readTriggers(query),
    readEnums(query),
    readViews(query),
    readExtensions(query),
    readFunctions(query),
    readPolicies(query),
  ])
  return {
    tables,
    columns,
    constraints,
    indexes,
    triggers,
    enums,
    views,
    extensions,
    functions,
    policies,
  }
}

/* v8 ignore stop */
