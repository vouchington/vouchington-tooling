export type CatalogQuery = <Row extends Record<string, unknown>>(
  sql: string,
  values?: readonly unknown[],
) => Promise<{ rows: Row[] }>

export type PartitionPolicy = {
  strategy: 'RANGE' | 'LIST -> RANGE'
  key: string
  children: 'default' | 'monthly' | 'list-default-range'
  retentionOwner: string | null
  accessClass: string
}

export type SchemaGrowthMaps = {
  partitionPolicies: ReadonlyMap<string, PartitionPolicy>
  unboundedUnpartitionedTables: ReadonlySet<string>
}

export type SchemaColumnSnapshot = {
  type: string
  nullable: boolean
  defaultExpression: string | null
  generatedExpression: string | null
  identity: 'always' | 'by default' | null
  generated: 'stored' | 'virtual' | null
  collation: string | null
  comment: string | null
  ordinalPosition: number
}

export type SchemaKeyConstraintSnapshot = {
  definition: string
  columns: string[]
}

export type SchemaForeignKeySnapshot = SchemaKeyConstraintSnapshot & {
  referencedTable: string
  referencedColumns: string[]
  onUpdate: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default'
  onDelete: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default'
  validated: boolean
}

export type SchemaIndexKeySnapshot = {
  column: string | null
  expression: string
  opclass: string
  descending: boolean
  nullsFirst: boolean
}

export type SchemaIndexSnapshot = {
  definition: string
  accessMethod: string
  unique: boolean
  primary: boolean
  constraintBacked: boolean
  valid: boolean
  ready: boolean
  keys: SchemaIndexKeySnapshot[]
  includedColumns: string[]
  predicate: string | null
}

export type SchemaPhysicalPartitionSnapshot = {
  strategy: 'hash' | 'list' | 'range'
  key: string
}

export type SchemaTableSnapshot = {
  relationKind: 'table' | 'partitioned table'
  columns: Record<string, SchemaColumnSnapshot>
  primaryKey: SchemaKeyConstraintSnapshot | null
  uniqueConstraints: Record<string, SchemaKeyConstraintSnapshot>
  checkConstraints: Record<string, string>
  foreignKeys: Record<string, SchemaForeignKeySnapshot>
  indexes: Record<string, SchemaIndexSnapshot>
  triggers: Record<string, string>
  comment: string | null
  physicalPartition: SchemaPhysicalPartitionSnapshot | null
  partition: PartitionPolicy | null
  growth: 'bounded' | 'unbounded'
}

export type SchemaViewSnapshot = {
  definition: string
  comment: string | null
  materialized: boolean
}

export type SchemaEnumSnapshot = {
  values: string[]
}

export type SchemaExtensionSnapshot = {
  version: string
}

export type SchemaFunctionSnapshot = {
  definition: string
}

export type SchemaPolicySnapshot = {
  table: string
  command: string
  pgRoles: string[]
  using: string | null
  withCheck: string | null
}

export type SchemaSnapshot = {
  formatVersion: 2
  tables: Record<string, SchemaTableSnapshot>
  views: Record<string, SchemaViewSnapshot>
  enums: Record<string, SchemaEnumSnapshot>
  extensions: Record<string, SchemaExtensionSnapshot>
  functions: Record<string, SchemaFunctionSnapshot>
  policies: Record<string, SchemaPolicySnapshot>
}
