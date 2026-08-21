import type { CatalogConstraintRow } from './catalog-queries.mts'
import { keyed } from './snapshot-build-utils.mts'
import type {
  SchemaColumnSnapshot,
  SchemaForeignKeySnapshot,
  SchemaKeyConstraintSnapshot,
  SchemaTableSnapshot,
} from './types.mts'

function assertConstraintColumns(
  tableName: string,
  columns: Record<string, SchemaColumnSnapshot>,
  constraint: Pick<CatalogConstraintRow, 'constraint_name' | 'columns'>,
): void {
  for (const column of constraint.columns) {
    if (!columns[column]) {
      throw new Error(
        `Constraint "${constraint.constraint_name}" on "${tableName}" references unknown column "${column}".`,
      )
    }
  }
}

function foreignKeySnapshot(
  tableName: string,
  columns: Record<string, SchemaColumnSnapshot>,
  constraint: CatalogConstraintRow,
): SchemaForeignKeySnapshot {
  assertConstraintColumns(tableName, columns, constraint)
  if (!constraint.referenced_table || !constraint.on_update || !constraint.on_delete) {
    throw new Error(
      `Foreign key "${constraint.constraint_name}" is missing referenced-table facts.`,
    )
  }
  return {
    definition: constraint.definition,
    columns: constraint.columns,
    referencedTable: constraint.referenced_table,
    referencedColumns: constraint.referenced_columns,
    onUpdate: constraint.on_update,
    onDelete: constraint.on_delete,
    validated: constraint.validated,
  }
}

export function buildTableConstraints({
  tableName,
  columns,
  constraints,
}: {
  tableName: string
  columns: Record<string, SchemaColumnSnapshot>
  constraints: CatalogConstraintRow[]
}): Pick<
  SchemaTableSnapshot,
  'primaryKey' | 'uniqueConstraints' | 'checkConstraints' | 'foreignKeys'
> {
  const primaryConstraint = constraints.find((constraint) => constraint.contype === 'p')
  if (primaryConstraint) assertConstraintColumns(tableName, columns, primaryConstraint)
  const primaryKey: SchemaKeyConstraintSnapshot | null = primaryConstraint
    ? { definition: primaryConstraint.definition, columns: primaryConstraint.columns }
    : null
  const uniqueConstraints: Record<string, SchemaKeyConstraintSnapshot> = {}
  const checkConstraints: Record<string, string> = {}
  const foreignKeys: Record<string, SchemaForeignKeySnapshot> = {}
  for (const constraint of constraints) {
    if (constraint.contype === 'u') {
      assertConstraintColumns(tableName, columns, constraint)
      uniqueConstraints[constraint.constraint_name] = {
        definition: constraint.definition,
        columns: constraint.columns,
      }
    }
    if (constraint.contype === 'c') {
      checkConstraints[constraint.constraint_name] = constraint.definition
    }
    if (constraint.contype === 'f') {
      foreignKeys[constraint.constraint_name] = foreignKeySnapshot(tableName, columns, constraint)
    }
  }
  return {
    primaryKey,
    uniqueConstraints: keyed(Object.entries(uniqueConstraints)),
    checkConstraints: keyed(Object.entries(checkConstraints)),
    foreignKeys: keyed(Object.entries(foreignKeys)),
  }
}
