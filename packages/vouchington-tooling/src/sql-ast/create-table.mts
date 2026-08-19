import { extractDefaultFunction, extractFuncCallArgColumnNames } from './default-function.mts'
import { parseSql } from './parser.mts'

export type SqlCreateTableColumnConstraint = {
  contype: string | null
}

export type SqlCreateTableColumn = {
  name: string
  location: number | null
  constraints: SqlCreateTableColumnConstraint[]
  isPrimaryKey: boolean
  defaultFunction: string | null
  /** Function name of a CONSTR_GENERATED expression (e.g. `uuid_extract_timestamp`), null if not generated or unrecognized. */
  generatedFunction: string | null
  /** Lowercased argument column names of a CONSTR_GENERATED expression's function call (e.g. `['id']`). */
  generatedFunctionArgColumns: string[]
}

export type SqlCreateTableMetadata = {
  tableName: string
  columns: SqlCreateTableColumn[]
}

/**
 * A column is a primary key via either the inline `col TYPE PRIMARY KEY` constraint
 * (nested inside its ColumnDef) or the table-level `PRIMARY KEY (col)` constraint
 * (a bare `Constraint` sibling in tableElts, referencing the column by name in `keys`).
 * Both forms are checked so table-level-PK migrations aren't silently mis-detected.
 */
export function extractCreateTableMetadata(content: string): SqlCreateTableMetadata[] {
  const tables: SqlCreateTableMetadata[] = []
  const parseResult = parseSql(content)

  for (const rawStmt of parseResult.stmts ?? []) {
    const node = rawStmt.stmt
    if (!node || !('CreateStmt' in node)) continue

    const createStmt = node.CreateStmt
    const tableName = createStmt.relation?.relname
    if (!tableName) continue

    const tableLevelPrimaryKeyColumns = new Set(
      (createStmt.tableElts ?? []).flatMap((elt) => {
        /* v8 ignore next 8 */
        if (!elt || typeof elt !== 'object' || !('Constraint' in elt)) return []
        const constraint = elt.Constraint
        if (constraint.contype !== 'CONSTR_PRIMARY') return []
        return (constraint.keys ?? []).flatMap((key) =>
          key && typeof key === 'object' && 'String' in key && typeof key.String.sval === 'string'
            ? [key.String.sval]
            : [],
        )
      }),
    )

    tables.push({
      tableName,
      columns: (createStmt.tableElts ?? []).flatMap((elt) => {
        if (!elt || typeof elt !== 'object' || !('ColumnDef' in elt)) return []

        const column = elt.ColumnDef
        if (!column || typeof column !== 'object' || !column.colname) return []

        const rawConstraints = (column.constraints ?? []).flatMap((constraint) => {
          /* v8 ignore next 4 */
          if (!constraint || typeof constraint !== 'object' || !('Constraint' in constraint)) {
            return []
          }
          return constraint.Constraint ? [constraint.Constraint] : []
        })
        let defaultConstraint: (typeof rawConstraints)[number] | undefined
        let generatedConstraint: (typeof rawConstraints)[number] | undefined
        for (const constraint of rawConstraints) {
          if (constraint.contype === 'CONSTR_DEFAULT') defaultConstraint ??= constraint
          if (constraint.contype === 'CONSTR_GENERATED') generatedConstraint ??= constraint
        }

        return [
          {
            name: column.colname,
            location: column.location ?? null,
            constraints: rawConstraints.map((constraint) => ({
              /* v8 ignore next */
              contype: constraint.contype ?? null,
            })),
            isPrimaryKey:
              rawConstraints.some((constraint) => constraint.contype === 'CONSTR_PRIMARY') ||
              tableLevelPrimaryKeyColumns.has(column.colname),
            defaultFunction: defaultConstraint
              ? extractDefaultFunction(defaultConstraint.raw_expr)
              : null,
            generatedFunction: generatedConstraint
              ? extractDefaultFunction(generatedConstraint.raw_expr)
              : null,
            generatedFunctionArgColumns: generatedConstraint
              ? extractFuncCallArgColumnNames(generatedConstraint.raw_expr)
              : [],
          },
        ]
      }),
    })
  }

  return tables
}
