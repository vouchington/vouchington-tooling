import type { ReaderPublicViewOptions } from './public-view-options.mts'
import { parseSql } from '../../sql-ast/parser.mts'
import { isRecord } from '../../sql-ast/unknown-record.mts'
import { extractStaticSqlTemplateQuasis } from './sql-source.mts'
import { nestedSelectStatements } from './public-view-ast.mts'
import { selectProtectsSourceRows } from './public-view-protection.mts'

export function composesPublicEligibilityView(
  content: string,
  options: ReaderPublicViewOptions,
): boolean {
  try {
    let foundSourceReader = false
    for (const sql of extractStaticSqlTemplateQuasis(content, options.sql)) {
      try {
        const tree = parseSql(sql)
        const readsSource = selectTreeReadsRelation(tree, options.sourceRelation)
        const readsEligibility = selectTreeReadsRelation(tree, options.eligibilityRelation)
        if (!readsSource && !readsEligibility) continue
        foundSourceReader = true
        if (readsSource && !selectTreeComposesPublicEligibility(tree, options)) return false
      } catch {
        // A fragment appended to a larger SQLStatement is not independently parseable.
      }
    }
    return foundSourceReader
  } catch {
    return false
  }
}

function selectTreeReadsRelation(tree: ReturnType<typeof parseSql>, relation: string): boolean {
  return tree.stmts!.some((statement) => containsRangeVar(statement, relation))
}

function containsRangeVar(value: unknown, relation: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsRangeVar(item, relation))
  if (!isRecord(value)) return false
  if (isRecord(value.RangeVar) && value.RangeVar.relname === relation) return true
  return Object.values(value).some((item) => containsRangeVar(item, relation))
}

function selectTreeComposesPublicEligibility(
  tree: ReturnType<typeof parseSql>,
  options: ReaderPublicViewOptions,
): boolean {
  const selects = tree.stmts!.flatMap((statement) =>
    isRecord(statement) && isRecord(statement.stmt) && isRecord(statement.stmt.SelectStmt)
      ? [statement.stmt.SelectStmt]
      : [],
  )
  return (
    selects.length > 0 &&
    selects.every((select) => selectScopesComposePublicEligibility(select, options))
  )
}

function selectScopesComposePublicEligibility(
  select: Record<string, unknown>,
  options: ReaderPublicViewOptions,
  inheritedCtes = new Map<string, Record<string, unknown>>(),
  visitingCtes = new Set<string>(),
): boolean {
  const ctes = new Map([...inheritedCtes, ...collectCteSelects(select.withClause)])
  if (!selectProtectsSourceRows(select, options)) return false

  const nestedSelects = nestedSelectStatements([
    select.fromClause,
    select.targetList,
    select.whereClause,
    select.havingClause,
    select.groupClause,
    select.distinctClause,
    select.sortClause,
    select.limitOffset,
    select.limitCount,
    select.windowClause,
    select.valuesLists,
  ])
  for (const branch of [select.larg, select.rarg]) {
    if (isRecord(branch)) nestedSelects.push(branch)
  }
  if (
    nestedSelects.some(
      (nested) => !selectScopesComposePublicEligibility(nested, options, ctes, visitingCtes),
    )
  ) {
    return false
  }

  function cteScopesCompose(name: string): boolean {
    if (visitingCtes.has(name)) return false
    const cte = ctes.get(name)
    if (!cte) return true
    const nextVisiting = new Set(visitingCtes).add(name)
    return selectScopesComposePublicEligibility(cte, options, ctes, nextVisiting)
  }
  return selectRangeRelationNames(select.fromClause).every(cteScopesCompose)
}

function collectCteSelects(withClause: unknown): Map<string, Record<string, unknown>> {
  const ctes = new Map<string, Record<string, unknown>>()
  if (!isRecord(withClause) || !Array.isArray(withClause.ctes)) return ctes
  for (const cte of withClause.ctes) {
    const expression = (
      cte as { CommonTableExpr: { ctename: string; ctequery: Record<string, unknown> } }
    ).CommonTableExpr
    if (isRecord(expression.ctequery.SelectStmt)) {
      ctes.set(expression.ctename, expression.ctequery.SelectStmt)
    }
  }
  return ctes
}

function selectRangeRelationNames(value: unknown): string[] {
  const names = new Set<string>()
  function collect(fromClause: unknown): void {
    if (Array.isArray(fromClause)) {
      for (const item of fromClause) collect(item)
      return
    }
    if (!isRecord(fromClause)) return
    if (isRecord(fromClause.RangeVar) && typeof fromClause.RangeVar.relname === 'string') {
      names.add(fromClause.RangeVar.relname)
      return
    }
    if (isRecord(fromClause.JoinExpr)) {
      collect(fromClause.JoinExpr.larg)
      collect(fromClause.JoinExpr.rarg)
    }
  }
  collect(value)
  return [...names]
}
