import type { SchemaCatalog } from './catalog-queries.mts'
import type {
  PartitionPolicy,
  SchemaGrowthMaps,
  SchemaSnapshot,
  SchemaTableSnapshot,
} from './types.mts'

export function emptyCatalog(): SchemaCatalog {
  return {
    tables: [],
    columns: [],
    constraints: [],
    indexes: [],
    triggers: [],
    enums: [],
    views: [],
    extensions: [],
    functions: [],
    policies: [],
  }
}

export function catalog(overrides: Partial<SchemaCatalog> = {}): SchemaCatalog {
  return { ...emptyCatalog(), ...overrides }
}

export function emptyGrowth(): SchemaGrowthMaps {
  return {
    partitionPolicies: new Map(),
    unboundedUnpartitionedTables: new Set(),
  }
}

export const WIDGETS_RANGE_POLICY: PartitionPolicy = {
  strategy: 'RANGE',
  key: 'id',
  children: 'monthly',
  retentionOwner: 'cleanup',
  accessClass: 'retention-window',
}

export function widgetsGrowth(overrides: Partial<SchemaGrowthMaps> = {}): SchemaGrowthMaps {
  return {
    partitionPolicies: new Map([['widgets', WIDGETS_RANGE_POLICY]]),
    unboundedUnpartitionedTables: new Set(['events']),
    ...overrides,
  }
}

export function emptySnapshot(): SchemaSnapshot {
  return {
    formatVersion: 2,
    tables: {},
    views: {},
    enums: {},
    extensions: {},
    functions: {},
    policies: {},
  }
}

export function widgetsTable(overrides: Partial<SchemaTableSnapshot> = {}): SchemaTableSnapshot {
  return {
    columns: {
      id: {
        type: 'uuid',
        nullable: false,
        defaultExpression: null,
        generatedExpression: null,
        identity: null,
        generated: null,
        collation: null,
        comment: null,
        ordinalPosition: 1,
      },
    },
    relationKind: 'table',
    primaryKey: null,
    uniqueConstraints: {},
    checkConstraints: {},
    foreignKeys: {},
    indexes: {},
    triggers: {},
    comment: null,
    physicalPartition: null,
    partition: null,
    growth: 'bounded',
    ...overrides,
  }
}

export function widgetsCatalogTable(relkind: 'p' | 'r' = 'r'): SchemaCatalog['tables'][number] {
  return {
    table_name: 'widgets',
    relkind,
    partition_strategy: relkind === 'p' ? 'r' : '',
    partition_key: relkind === 'p' ? 'RANGE (created_at)' : null,
    comment: null,
  }
}

export function columnRow(
  tableName: string,
  columnName: string,
  overrides: Partial<SchemaCatalog['columns'][number]> = {},
): SchemaCatalog['columns'][number] {
  return {
    table_name: tableName,
    column_name: columnName,
    data_type: 'uuid',
    nullable: false,
    default_expression: null,
    identity: '',
    generated: '',
    collation: null,
    comment: null,
    ordinal_position: 1,
    ...overrides,
  }
}
