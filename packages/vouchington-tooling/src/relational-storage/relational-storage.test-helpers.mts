import type {
  SchemaColumnSnapshot,
  SchemaForeignKeySnapshot,
  SchemaSnapshot,
  SchemaTableSnapshot,
} from '../pg-schema-snapshot/types.mts'

export const SNAPSHOT_PATH = 'db/schema-snapshot/schema.json'

export function column(
  type: string,
  overrides: Partial<SchemaColumnSnapshot> = {},
): SchemaColumnSnapshot {
  const generatedExpression = overrides.generatedExpression ?? null
  return {
    type,
    nullable: true,
    defaultExpression: null,
    generatedExpression,
    identity: null,
    generated: generatedExpression ? 'virtual' : null,
    collation: null,
    comment: null,
    ordinalPosition: 1,
    ...overrides,
  }
}

export function foreignKey(
  columnName: string,
  overrides: Partial<SchemaForeignKeySnapshot> = {},
): SchemaForeignKeySnapshot {
  return {
    columns: [columnName],
    definition: `FOREIGN KEY (${columnName}) REFERENCES owners (id)`,
    referencedTable: 'owners',
    referencedColumns: ['id'],
    onUpdate: 'no action',
    onDelete: 'restrict',
    validated: true,
    ...overrides,
  }
}

export function plainTable(
  columns: Record<string, SchemaColumnSnapshot> = {},
): SchemaTableSnapshot {
  return {
    relationKind: 'table',
    columns,
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
  }
}

export function snapshot(
  tableName: string,
  columns: Record<string, SchemaColumnSnapshot>,
): SchemaSnapshot {
  return {
    formatVersion: 2,
    tables: { [tableName]: plainTable(columns) },
    views: {},
    enums: {},
    extensions: {},
    functions: {},
    policies: {},
  }
}
