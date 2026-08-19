import type { Node } from '@libpg-query/parser'

/**
 * Resolves a CONSTR_DEFAULT constraint's raw_expr to a lowercase function/op name.
 * Handles the shapes @libpg-query/parser produces for column defaults:
 * - `FuncCall` (e.g. `uuidv7()`, `now()`): last segment of `funcname`, lowercased.
 * - `SQLValueFunction` (e.g. bare `CURRENT_TIMESTAMP`): mapped from its `op` enum.
 * - `TypeCast` (e.g. `now()::timestamptz`): recurses into the cast's inner arg.
 * Returns null for any other/unrecognized raw_expr shape.
 */
export function extractDefaultFunction(rawExpr: Node | undefined): string | null {
  if (!rawExpr) return null

  if ('TypeCast' in rawExpr) {
    return extractDefaultFunction(rawExpr.TypeCast.arg)
  }

  if ('FuncCall' in rawExpr) {
    const funcname = rawExpr.FuncCall.funcname ?? []
    const last = funcname.at(-1)
    if (last && 'String' in last && typeof last.String.sval === 'string') {
      return last.String.sval.toLowerCase()
    }
    return null
  }

  if ('SQLValueFunction' in rawExpr) {
    return rawExpr.SQLValueFunction.op === 'SVFOP_CURRENT_TIMESTAMP' ? 'current_timestamp' : null
  }

  return null
}

/**
 * Resolves a FuncCall raw_expr's argument column names, lowercased (e.g. the `id` in
 * `uuid_extract_timestamp(id)`). Used to verify a GENERATED column expression references
 * a specific source column, not just that it calls the expected function.
 * Returns an empty array for non-FuncCall shapes, a TypeCast-wrapped call recurses into
 * its inner arg; non-column-ref args are skipped.
 */
export function extractFuncCallArgColumnNames(rawExpr: Node | undefined): string[] {
  if (!rawExpr) return []

  if ('TypeCast' in rawExpr) {
    return extractFuncCallArgColumnNames(rawExpr.TypeCast.arg)
  }

  if (!('FuncCall' in rawExpr)) return []

  return (rawExpr.FuncCall.args ?? []).flatMap((arg) => {
    if (!arg || typeof arg !== 'object' || !('ColumnRef' in arg)) return []
    const fields = arg.ColumnRef.fields ?? []
    const last = fields.at(-1)
    /* v8 ignore next 4 */
    return last && 'String' in last && typeof last.String.sval === 'string'
      ? [last.String.sval.toLowerCase()]
      : []
  })
}
