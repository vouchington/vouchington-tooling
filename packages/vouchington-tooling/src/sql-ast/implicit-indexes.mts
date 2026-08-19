import { isRecord } from './unknown-record.mts'
import type { SqlCreateIndexMetadata, SqlIndexParam } from './index-metadata.mts'

function implicitIndexParam(name: string): SqlIndexParam {
  return { name, opclass: null, ordering: null, nullsOrdering: null }
}

function pushImplicitIndex(
  indexes: SqlCreateIndexMetadata[],
  relname: string,
  location: number,
  columnNames: string[],
): void {
  indexes.push({
    relname,
    idxname: null,
    unique: true,
    indexParams: columnNames,
    indexParamDetails: columnNames.map(implicitIndexParam),
    includeParams: [],
    whereClause: null,
    whereClauseKey: null,
    accessMethod: 'btree',
    location,
  })
}

function constraintKeyNames(constraint: Record<string, unknown>): string[] {
  const keys = constraint.keys
  if (!Array.isArray(keys)) return []
  return keys.flatMap((key) => {
    const sval = isRecord(key) && isRecord(key.String) ? key.String.sval : undefined
    /* v8 ignore next */
    return typeof sval === 'string' ? [sval] : []
  })
}

/** UNIQUE/PRIMARY KEY create implicit unique indexes that never appear as CREATE INDEX. */
export function collectCreateStmtImplicitIndexes(
  statement: Record<string, unknown>,
  location: number,
  indexes: SqlCreateIndexMetadata[],
): void {
  const relation = statement.relation
  const relname =
    isRecord(relation) && typeof relation.relname === 'string' ? relation.relname : null
  const tableElts = statement.tableElts
  if (!relname || !Array.isArray(tableElts)) return

  for (const element of tableElts) {
    if (!isRecord(element)) continue

    if (isRecord(element.ColumnDef)) {
      const column = element.ColumnDef
      const colname = typeof column.colname === 'string' ? column.colname : null
      if (!colname) continue
      for (const constraintNode of (column.constraints as unknown[] | undefined) ?? []) {
        /* v8 ignore next */
        if (!isRecord(constraintNode) || !isRecord(constraintNode.Constraint)) continue
        const contype = constraintNode.Constraint.contype
        if (contype !== 'CONSTR_UNIQUE' && contype !== 'CONSTR_PRIMARY') continue
        pushImplicitIndex(indexes, relname, location, [colname])
      }
      continue
    }

    /* v8 ignore next */
    if (!isRecord(element.Constraint)) continue
    const contype = element.Constraint.contype
    if (contype !== 'CONSTR_UNIQUE' && contype !== 'CONSTR_PRIMARY') continue
    const columnNames = constraintKeyNames(element.Constraint)
    if (columnNames.length === 0) continue
    pushImplicitIndex(indexes, relname, location, columnNames)
  }
}
