import type { SchemaTableSnapshot } from '../pg-schema-snapshot/types.mts'
import type {
  GeneratedFkAlias,
  GeneratedSelfRootAlias,
  ResolvedRelationalStorageCatalog,
} from './relational-storage-types.mts'
import { coveredByForeignKey, isSolePrimaryKey } from './type-rules.mts'

function wrapsFully(value: string): boolean {
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    if (depth === 0) return index === value.length - 1
  }
  return false
}

function normalizeCheckBody(definition: string): string {
  let body = definition
    .trim()
    .replace(/\s+/gu, '')
    .toLowerCase()
    .replace(/^check/u, '')
  while (body.startsWith('(') && body.endsWith(')') && wrapsFully(body)) {
    body = body.slice(1, -1)
  }
  return body
}

function hasExactCheck(table: SchemaTableSnapshot, expected: string): boolean {
  const normalizedExpected = normalizeCheckBody(expected)
  return Object.values(table.checkConstraints).some(
    (definition) => normalizeCheckBody(definition) === normalizedExpected,
  )
}

export function isGeneratedFkAlias(
  table: SchemaTableSnapshot,
  expression: string | null,
  expected: GeneratedFkAlias,
): boolean {
  return (
    expression === expected.expression &&
    expected.sourceColumns.every((name) => coveredByForeignKey(table, name)) &&
    hasExactCheck(table, expected.oneTargetCheck)
  )
}

export function isGeneratedSelfRootAlias(
  tableName: string,
  table: SchemaTableSnapshot,
  columnName: string,
  expression: string | null,
  expected: GeneratedSelfRootAlias,
): boolean {
  const normalizedExpression = expression?.replace(/\s+/gu, ' ').trim().toLowerCase()
  const normalizedExpected = expected.expression.replace(/\s+/gu, ' ').trim().toLowerCase()
  const hasSelfRootForeignKey = Object.values(table.foreignKeys).some(
    (fk) =>
      fk.columns.length === 1 &&
      fk.columns[0] === expected.selfReferenceColumn &&
      fk.referencedTable === tableName &&
      fk.referencedColumns.length === 1 &&
      fk.referencedColumns[0] === columnName &&
      fk.validated,
  )
  return (
    normalizedExpression === normalizedExpected &&
    isSolePrimaryKey(table, expected.primaryKeyColumn) &&
    hasSelfRootForeignKey
  )
}

export function isGeneratedAlias(
  tableName: string,
  table: SchemaTableSnapshot,
  columnName: string,
  expression: string | null,
  catalog: Pick<
    ResolvedRelationalStorageCatalog,
    'generatedFkAliases' | 'generatedSelfRootAliases'
  >,
): boolean {
  const key = `${tableName}.${columnName}`
  const selfRoot = catalog.generatedSelfRootAliases.get(key)
  if (selfRoot !== undefined) {
    return isGeneratedSelfRootAlias(tableName, table, columnName, expression, selfRoot)
  }
  const fkAlias = catalog.generatedFkAliases.get(key)
  return fkAlias !== undefined && isGeneratedFkAlias(table, expression, fkAlias)
}
