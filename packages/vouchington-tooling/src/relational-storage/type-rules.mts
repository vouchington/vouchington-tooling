import type { SchemaColumnSnapshot, SchemaTableSnapshot } from '../pg-schema-snapshot/types.mts'

const KNOWN_NON_DOMAIN_TYPES = new Set([
  'bigint',
  'bigserial',
  'bit',
  'bit varying',
  'boolean',
  'box',
  'bytea',
  'character',
  'character varying',
  'cid',
  'cidr',
  'circle',
  'date',
  'double precision',
  'inet',
  'integer',
  'interval',
  'json',
  'jsonb',
  'line',
  'lseg',
  'macaddr',
  'macaddr8',
  'money',
  'name',
  'numeric',
  'oid',
  'path',
  'pg_lsn',
  'point',
  'polygon',
  'real',
  'smallint',
  'smallserial',
  'serial',
  'text',
  'tid',
  'time',
  'time with time zone',
  'time without time zone',
  'timestamp',
  'timestamp with time zone',
  'timestamp without time zone',
  'tsquery',
  'tsvector',
  'txid_snapshot',
  'uuid',
  'varbit',
  'varchar',
  'vector',
  'xid',
  'xid8',
  'xml',
])

const ENCODED_TEXT_TYPES = new Set([
  'text',
  'character varying',
  'varchar',
  'character',
  'char',
  'name',
])

export const ENCODED_KEY_NAME = /^(?:work|entity|relation|target)_key$/u

export function relationalStorageDiagnostic(
  snapshotPath: string,
  column: string,
  message: string,
): string {
  return `::error file=${snapshotPath}::${column}: ${message}`
}

export function coveredByForeignKey(table: SchemaTableSnapshot, name: string): boolean {
  return Object.values(table.foreignKeys).some((fk) => fk.columns.includes(name))
}

export function typeBase(type: string): string {
  return type
    .toLowerCase()
    .trim()
    .replace(/(?:\[\])+$/u, '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim()
}

export function isKnownColumnType(
  type: string,
  enums: Readonly<Record<string, unknown>>,
  extraKnownTypes: ReadonlySet<string>,
): boolean {
  const base = typeBase(type)
  return KNOWN_NON_DOMAIN_TYPES.has(base) || extraKnownTypes.has(base) || Object.hasOwn(enums, base)
}

export function isIndependentlyGenerated(column: SchemaColumnSnapshot): boolean {
  const expression = column.defaultExpression?.toLowerCase() ?? ''
  return (
    column.identity != null ||
    /\buuidv7\s*\(/u.test(expression) ||
    /\bgen_random_uuid\s*\(/u.test(expression)
  )
}

export function isSolePrimaryKey(table: SchemaTableSnapshot, columnName: string): boolean {
  return table.primaryKey?.columns.length === 1 && table.primaryKey.columns[0] === columnName
}

export function isEncodedText(type: string): boolean {
  return ENCODED_TEXT_TYPES.has(typeBase(type))
}
