import type { parseSync } from '@libpg-query/parser'
import { parseSql } from './parser.mts'

type ParsedIndexStmt = Extract<
  NonNullable<NonNullable<ReturnType<typeof parseSync>['stmts']>[number]['stmt']>,
  { IndexStmt: unknown }
>['IndexStmt']

/**
 * Extracts a canonical "shape key" for every top-level CREATE INDEX statement in the given SQL,
 * for detecting index definitions that build the same physical index under different names.
 *
 * The key is built from normalized `IndexStmt` AST fields (table, uniqueness, access method, each
 * indexed column/expression with its *effective* sort order and null ordering, and the predicate
 * with position-dependent `location` fields stripped) rather than from raw source text. This
 * canonicalizes cosmetic syntax variance that leaves the physical index unchanged:
 * - implicit vs. explicit `ASC` (`SORTBY_DEFAULT` is normalized to `SORTBY_ASC`, PostgreSQL's
 *   actual default for btree ordering);
 * - implicit vs. explicit `NULLS FIRST`/`NULLS LAST` (PostgreSQL's real default depends on sort
 *   direction — `NULLS LAST` for ascending, `NULLS FIRST` for descending — so
 *   `SORTBY_NULLS_DEFAULT` is resolved against the effective ordering rather than compared as-is);
 * - redundant parentheses in a predicate or expression (parentheses are pure grouping and leave no
 *   trace in the parsed AST once `location` offsets — which shift under added parens even though
 *   the tree shape is unchanged — are stripped before comparison).
 *
 * Operator classes, collations, and INCLUDE columns are intentionally NOT modeled; callers whose
 * generators use them must extend the projection before using this collision policy for those SQL.
 *
 * @libpg-query/parser has no deparse/SQL-regeneration function, so this hashes a normalized JSON
 * projection of the relevant AST subtrees instead of reconstructing SQL text.
 *
 * DO $$ ... END $$; blocks are opaque to the top-level parser — they appear as a single DoStmt,
 * not individual IndexStmt nodes — so nested CREATE INDEX statements are not covered.
 *
 * Unparseable SQL throws rather than returning an empty shape list.
 * Requires initSqlAst() to have resolved before the first call.
 */
export function extractIndexShapes(
  sql: string,
): { idxname: string; table: string; shapeKey: string }[] {
  if (!sql.trim()) return []
  const result = parseSql(sql)
  const shapes: { idxname: string; table: string; shapeKey: string }[] = []
  for (const stmt of result.stmts ?? []) {
    const node = stmt.stmt
    if (!node || !('IndexStmt' in node)) continue
    const indexStmt = node.IndexStmt
    const idxname = indexStmt.idxname
    if (!idxname) continue
    const table = indexStmt.relation?.relname ?? ''
    const canonical = {
      table,
      unique: Boolean(indexStmt.unique),
      accessMethod: indexStmt.accessMethod ?? 'btree',
      indexParams: (indexStmt.indexParams ?? []).map(normalizeIndexParam),
      whereClause: indexStmt.whereClause ? stripLocations(indexStmt.whereClause) : null,
    }
    shapes.push({ idxname, table, shapeKey: JSON.stringify(canonical) })
  }
  return shapes
}

function normalizeIndexParam(param: NonNullable<ParsedIndexStmt['indexParams']>[number]): unknown {
  if (!('IndexElem' in param)) return stripLocations(param)
  const elem = param.IndexElem
  const ordering =
    elem.ordering === undefined || elem.ordering === 'SORTBY_DEFAULT' ? 'SORTBY_ASC' : elem.ordering
  const nullsOrdering =
    elem.nulls_ordering === undefined || elem.nulls_ordering === 'SORTBY_NULLS_DEFAULT'
      ? ordering === 'SORTBY_DESC'
        ? 'SORTBY_NULLS_FIRST'
        : 'SORTBY_NULLS_LAST'
      : elem.nulls_ordering
  return {
    key: elem.name ?? stripLocations(elem.expr),
    ordering,
    nullsOrdering,
  }
}

function stripLocations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLocations)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      if (key === 'location') continue
      out[key] = stripLocations(val)
    }
    return out
  }
  return value
}
