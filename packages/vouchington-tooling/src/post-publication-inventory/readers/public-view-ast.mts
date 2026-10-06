import type { ReaderPublicViewOptions } from './public-view-options.mts'
import { isRecord } from '../../sql-ast/unknown-record.mts'

export function nestedSelectStatements(value: unknown): Record<string, unknown>[] {
  const selects: Record<string, unknown>[] = []
  function collect(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) collect(item)
      return
    }
    if (!isRecord(node)) return
    if (isRecord(node.SelectStmt)) {
      selects.push(node.SelectStmt)
      return
    }
    for (const child of Object.values(node)) collect(child)
  }
  collect(value)
  return selects
}

export function containsEligibilitySourceEquality(
  values: unknown[],
  aliases: { eligibility: Set<string>; sourceRows: Set<string> },
  options: ReaderPublicViewOptions,
): boolean {
  function collect(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(collect)
    if (!isRecord(value)) return false
    if (
      isRecord(value.BoolExpr) &&
      (value.BoolExpr.boolop === 'OR_EXPR' || value.BoolExpr.boolop === 'NOT_EXPR')
    ) {
      return false
    }
    if (isRecord(value.A_Expr) && value.A_Expr.kind === 'AEXPR_OP' && isEquals(value.A_Expr)) {
      const left = columnReference(value.A_Expr.lexpr)
      const right = columnReference(value.A_Expr.rexpr)
      if (
        (isEligibilityId(left, aliases.eligibility, options) &&
          isSourceId(right, aliases.sourceRows, options)) ||
        (isEligibilityId(right, aliases.eligibility, options) &&
          isSourceId(left, aliases.sourceRows, options))
      ) {
        return true
      }
    }
    if (isRecord(value.A_Expr) || isRecord(value.BooleanTest) || isRecord(value.CaseExpr)) {
      return false
    }
    return Object.values(value).some(collect)
  }
  return values.some(collect)
}

function isEquals(expression: Record<string, unknown>): boolean {
  return (
    Array.isArray(expression.name) &&
    expression.name.some((value) => isRecord(value.String) && value.String.sval === '=')
  )
}

function columnReference(value: unknown): { alias: string; column: string } | null {
  if (!isRecord(value) || !isRecord(value.ColumnRef) || !Array.isArray(value.ColumnRef.fields)) {
    return null
  }
  const fields = value.ColumnRef.fields.flatMap((field) =>
    isRecord(field.String) && typeof field.String.sval === 'string' ? [field.String.sval] : [],
  )
  if (fields.length !== 2) return null
  return { alias: fields[0], column: fields[1] }
}

function isEligibilityId(
  value: { alias: string; column: string } | null,
  aliases: Set<string>,
  options: ReaderPublicViewOptions,
): boolean {
  return value !== null && value.column === options.eligibilityIdColumn && aliases.has(value.alias)
}

function isSourceId(
  value: { alias: string; column: string } | null,
  aliases: Set<string>,
  options: ReaderPublicViewOptions,
): boolean {
  return value !== null && value.column === options.sourceIdColumn && aliases.has(value.alias)
}
