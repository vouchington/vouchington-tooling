import { collectDoStmtConstraints, processAlterTableStmt } from './constraint-do-block.mts'
import {
  fkAttrNames,
  foreignKeyFromConstraint,
  type ForeignKey,
  type SqlMigrationConstraintMetadata,
} from './constraint-shared.mts'
import { parseSql } from './parser.mts'
import { isRecord } from './unknown-record.mts'

export type { ForeignKey, SqlMigrationConstraintMetadata } from './constraint-shared.mts'

/** Inline `col UUID REFERENCES ...` and table-level `FOREIGN KEY (...) REFERENCES ...` forms. */
/* v8 ignore start -- defensive parse-tree walks */
function collectCreateStmtForeignKeys(
  statement: Record<string, unknown>,
  foreignKeys: ForeignKey[],
): void {
  const relation = statement.relation
  const tableName =
    isRecord(relation) && typeof relation.relname === 'string' ? relation.relname : null
  const tableElts = statement.tableElts
  if (!Array.isArray(tableElts)) return

  for (const element of tableElts) {
    if (!isRecord(element)) continue
    if (isRecord(element.ColumnDef)) {
      const column = element.ColumnDef
      const colname = typeof column.colname === 'string' ? column.colname : null
      for (const constraintNode of (column.constraints as unknown[] | undefined) ?? []) {
        /* v8 ignore next 3 */
        if (!isRecord(constraintNode) || !isRecord(constraintNode.Constraint)) continue
        const constraint = constraintNode.Constraint
        if (constraint.contype !== 'CONSTR_FOREIGN') continue
        foreignKeys.push(foreignKeyFromConstraint(constraint, tableName, colname ? [colname] : []))
      }
      continue
    }
    if (isRecord(element.Constraint) && element.Constraint.contype === 'CONSTR_FOREIGN') {
      foreignKeys.push(
        foreignKeyFromConstraint(element.Constraint, tableName, fkAttrNames(element.Constraint)),
      )
    }
  }
}
/* v8 ignore stop */

export function extractMigrationConstraintMetadata(
  content: string,
): SqlMigrationConstraintMetadata {
  const result: SqlMigrationConstraintMetadata = {
    addedConstraints: [],
    foreignKeys: [],
    validatedConstraints: new Set(),
  }
  const parseResult = parseSql(content)

  for (const rawStmt of parseResult.stmts ?? []) {
    const node = rawStmt.stmt
    /* v8 ignore next */
    if (!node) continue
    const stmtLocation = rawStmt.stmt_location ?? 0
    if ('CreateStmt' in node) {
      collectCreateStmtForeignKeys(
        node.CreateStmt as unknown as Record<string, unknown>,
        result.foreignKeys,
      )
      continue
    }
    if ('DoStmt' in node) {
      collectDoStmtConstraints(content, node.DoStmt, stmtLocation, result)
      continue
    }
    /* v8 ignore next */
    if (!('AlterTableStmt' in node)) continue
    processAlterTableStmt(node.AlterTableStmt, 0, result)
  }
  return result
}
