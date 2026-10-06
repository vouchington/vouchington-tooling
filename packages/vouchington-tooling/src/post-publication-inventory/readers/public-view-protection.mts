import type { ReaderPublicViewOptions } from './public-view-options.mts'
import { isRecord } from '../../sql-ast/unknown-record.mts'
import { containsEligibilitySourceEquality } from './public-view-ast.mts'

type Aliases = { eligibility: Set<string>; sourceRows: Set<string> }

export function selectProtectsSourceRows(
  select: Record<string, unknown>,
  options: ReaderPublicViewOptions,
): boolean {
  const aliases = collectSelectAliases(select.fromClause, options)
  return (
    aliases.sourceRows.size === 0 ||
    (aliases.eligibility.size > 0 &&
      (containsEligibilitySourceEquality([select.whereClause], aliases, options) ||
        filteringJoinContainsEligibilityEquality(
          select.fromClause as Record<string, unknown>[],
          aliases,
          options,
        ))) ||
    correlatedEligibilitySubqueryComposes(select, aliases.sourceRows, options)
  )
}

function correlatedEligibilitySubqueryComposes(
  select: Record<string, unknown>,
  outerSourceAliases: Set<string>,
  options: ReaderPublicViewOptions,
): boolean {
  function containsPositiveEligibilityExists(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(containsPositiveEligibilityExists)
    if (!isRecord(value)) return false
    if (
      isRecord(value.BoolExpr) &&
      (value.BoolExpr.boolop === 'OR_EXPR' || value.BoolExpr.boolop === 'NOT_EXPR')
    ) {
      return false
    }
    if (isRecord(value.A_Expr) || isRecord(value.BooleanTest) || isRecord(value.CaseExpr)) {
      return false
    }
    if (
      isRecord(value.SubLink) &&
      value.SubLink.subLinkType === 'EXISTS_SUBLINK' &&
      isRecord(value.SubLink.subselect) &&
      isRecord(value.SubLink.subselect.SelectStmt)
    ) {
      const nested = value.SubLink.subselect.SelectStmt
      const nestedAliases = collectSelectAliases(nested.fromClause, options)
      return (
        nestedAliases.eligibility.size > 0 &&
        containsEligibilitySourceEquality(
          [nested.fromClause, nested.whereClause],
          {
            eligibility: nestedAliases.eligibility,
            sourceRows: outerSourceAliases,
          },
          options,
        )
      )
    }
    return Object.values(value).some(containsPositiveEligibilityExists)
  }
  return containsPositiveEligibilityExists(select.whereClause)
}

function filteringJoinContainsEligibilityEquality(
  value: Record<string, unknown> | Record<string, unknown>[],
  aliases: Aliases,
  options: ReaderPublicViewOptions,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => filteringJoinContainsEligibilityEquality(item, aliases, options))
  }
  if (isRecord(value.JoinExpr)) {
    if (
      value.JoinExpr.jointype === 'JOIN_INNER' &&
      containsEligibilitySourceEquality([value.JoinExpr.quals], aliases, options)
    ) {
      return true
    }
    return (
      filteringJoinContainsEligibilityEquality(
        value.JoinExpr.larg as Record<string, unknown>,
        aliases,
        options,
      ) ||
      filteringJoinContainsEligibilityEquality(
        value.JoinExpr.rarg as Record<string, unknown>,
        aliases,
        options,
      )
    )
  }
  return false
}

function collectSelectAliases(value: unknown, options: ReaderPublicViewOptions): Aliases {
  const aliases: Aliases = { eligibility: new Set<string>(), sourceRows: new Set<string>() }
  function collect(fromClause: unknown): void {
    if (Array.isArray(fromClause)) {
      for (const item of fromClause) collect(item)
      return
    }
    if (!isRecord(fromClause)) return
    if (isRecord(fromClause.RangeVar)) {
      const range = fromClause.RangeVar
      const relationName = range.relname as string
      const alias =
        isRecord(range.alias) && typeof range.alias.aliasname === 'string'
          ? range.alias.aliasname
          : relationName
      if (relationName === options.eligibilityRelation) aliases.eligibility.add(alias)
      if (relationName === options.sourceRelation) aliases.sourceRows.add(alias)
      return
    }
    if (isRecord(fromClause.JoinExpr)) {
      collect(fromClause.JoinExpr.larg)
      collect(fromClause.JoinExpr.rarg)
    }
  }
  collect(value)
  return aliases
}
