import { collectCreateStmtImplicitIndexes } from './implicit-indexes.mts'
import { parseSql } from './parser.mts'
import { isRecord } from './unknown-record.mts'

// Name, opclass, and sort spec all participate in redundancy comparisons.
export type SqlIndexParam = {
  name: string | null
  opclass: string | null
  ordering: string | null
  nullsOrdering: string | null
}

export type SqlCreateIndexMetadata = {
  relname: string
  idxname: string | null
  unique: boolean
  indexParams: Array<string | null>
  indexParamDetails: SqlIndexParam[]
  includeParams: string[]
  whereClause: unknown
  whereClauseKey: string | null
  accessMethod: string
  location: number
}

function indexElemName(param: unknown): string | null {
  if (!isRecord(param) || !isRecord(param.IndexElem)) return null
  const name = param.IndexElem.name
  return typeof name === 'string' ? name : null
}

function indexElemOpclass(param: unknown): string | null {
  if (!isRecord(param) || !isRecord(param.IndexElem)) return null
  const opclass = param.IndexElem.opclass
  if (!Array.isArray(opclass)) return null
  const names = opclass.flatMap((node) => {
    const sval = isRecord(node) && isRecord(node.String) ? node.String.sval : undefined
    /* v8 ignore next */
    return typeof sval === 'string' ? [sval] : []
  })
  return names.length > 0 ? names.join('.') : null
}

/** Sort direction and NULLS placement together — PostgreSQL resolves both from the same `IndexElem`. */
function indexElemSortSpec(param: unknown): Pick<SqlIndexParam, 'ordering' | 'nullsOrdering'> {
  if (!isRecord(param) || !isRecord(param.IndexElem)) return { ordering: null, nullsOrdering: null }
  const { ordering, nulls_ordering: nullsOrdering } = param.IndexElem
  return {
    ordering: typeof ordering === 'string' ? ordering : null,
    nullsOrdering: typeof nullsOrdering === 'string' ? nullsOrdering : null,
  }
}

function indexParamDetail(param: unknown): SqlIndexParam {
  return {
    name: indexElemName(param),
    opclass: indexElemOpclass(param),
    ...indexElemSortSpec(param),
  }
}

/**
 * Deep-clones a parser AST node with `location` fields stripped, so two
 * predicates that are byte-identical apart from source position compare
 * equal via JSON.stringify.
 */
function stripLocations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLocations)
  if (!isRecord(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'location') continue
    result[key] = stripLocations(child)
  }
  return result
}

function whereClauseKey(whereClause: unknown): string | null {
  if (whereClause === undefined || whereClause === null) return null
  return JSON.stringify(stripLocations(whereClause))
}

export function extractCreateIndexMetadata(content: string): SqlCreateIndexMetadata[] {
  const indexes: SqlCreateIndexMetadata[] = []
  const parseResult = parseSql(content)

  for (const rawStmt of parseResult.stmts ?? []) {
    const node = rawStmt.stmt
    /* v8 ignore next */
    if (!node) continue

    if ('CreateStmt' in node) {
      collectCreateStmtImplicitIndexes(
        node.CreateStmt as unknown as Record<string, unknown>,
        rawStmt.stmt_location ?? 0,
        indexes,
      )
      continue
    }

    /* v8 ignore next */
    if (!('IndexStmt' in node)) continue

    const indexStmt = node.IndexStmt
    const relname = indexStmt.relation?.relname
    /* v8 ignore next */
    if (!relname) continue

    const indexParams = indexStmt.indexParams ?? []
    indexes.push({
      relname,
      idxname: indexStmt.idxname ?? null,
      unique: indexStmt.unique === true,
      indexParams: indexParams.map(indexElemName),
      indexParamDetails: indexParams.map(indexParamDetail),
      includeParams: (indexStmt.indexIncludingParams ?? [])
        .map(indexElemName)
        .filter((name): name is string => name !== null),
      whereClause: indexStmt.whereClause ?? null,
      whereClauseKey: whereClauseKey(indexStmt.whereClause),
      accessMethod: indexStmt.accessMethod ?? 'btree',
      location: rawStmt.stmt_location ?? 0,
    })
  }

  return indexes
}
