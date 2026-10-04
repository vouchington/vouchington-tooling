import ts from '../contract-schema/typescript-api.mts'

import { isContextMethod } from './response-contract-route-analysis.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

export function responseStatusCodesForContract(contract: BackendResponseContract): number[] {
  if (contract.statusKnowledge === 'unknown') return []
  if (contract.statusCodes) return [...new Set(contract.statusCodes)].toSorted((a, b) => a - b)
  const bodyKind = contract.bodyKind ?? (contract.schema.root.type === 'null' ? 'none' : 'content')
  return [bodyKind === 'none' ? 204 : 200]
}

/**
 * Maps `METHOD:/route` to the non-error static `ctx.setStatus(NNN)` literal(s) found for that
 * route binding: a plain literal contributes one status; `ctx.setStatus(cond ? A : B)` with both
 * branches numeric contributes both (the doc can't know which branch fires at request time, so
 * both are valid statuses for the operation). Statuses >= 400 are dropped per-branch: they mark
 * hand-rolled error branches (the shared `default` -> `components/responses/Error` already
 * documents error responses), and capturing them here would misattribute an error status to the
 * whole operation. A route absent from the map never sets a non-error status explicitly (callers
 * fall back to 200, or 204 when the response schema's root is `null`).
 */
/**
 * Resolves the status documented for one specific `apiResponse`/`apiNoContent` marker call: the
 * nearest preceding sibling `ctx.setStatus(NNN)` literal, walking outward through enclosing
 * blocks (mirroring `response-contract-implicit.mts`'s `precededByErrorStatus` walk). Unlike
 * `collectRouteStatusCodes`, this has no `>=400` filter: an explicit `#variant` marker is a
 * deliberate author opt-in to document that exact status (e.g. 422 for a `#validation` variant),
 * and the route-wide map (keyed only on `method:routeTemplate`) can't tell two markers in the
 * same route apart when they're preceded by different statuses.
 */
export function resolveEmissionStatus(
  call: ts.CallExpression | ts.NewExpression,
  matchesContext: (expression: ts.Expression) => boolean = (expression) =>
    isContextMethod(expression, 'setStatus'),
): {
  statusCodes?: readonly [number, ...number[]]
  statusKnowledge: 'default' | 'explicit' | 'unknown'
  unavailableReason?: string
} {
  if (ts.isCallExpression(call) && matchesContext(call.expression))
    return statusArgument(call.arguments[0])
  let statement: ts.Node = call
  while (!ts.isStatement(statement)) statement = statement.parent
  return precedingStatus(statement as ts.Statement, matchesContext)
}

function precedingStatus(
  statement: ts.Statement,
  matchesContext: (expression: ts.Expression) => boolean,
): ReturnType<typeof statusArgument> {
  const block = statement.parent
  if (!ts.isBlock(block)) return { statusKnowledge: 'default' }
  const index = block.statements.indexOf(statement)
  for (let i = index - 1; i >= 0; i--) {
    const status = statusStatement(block.statements[i]!, matchesContext)
    if (status) return status
  }
  const enclosing = block.parent
  return ts.isStatement(enclosing)
    ? precedingStatus(enclosing, matchesContext)
    : { statusKnowledge: 'default' }
}

function statusStatement(
  statement: ts.Statement,
  matchesContext: (expression: ts.Expression) => boolean,
): ReturnType<typeof statusArgument> | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined
  const expression = statement.expression
  if (!ts.isCallExpression(expression) || !matchesContext(expression.expression)) return undefined
  return statusArgument(expression.arguments[0])
}

/** A `ctx.setStatus` argument's possible numeric literal value(s): one for a bare literal, up to two (sorted ascending) for `cond ? A : B` when both branches are numeric literals. */
function statusArgument(argument: ts.Expression | undefined): {
  statusCodes?: readonly [number, ...number[]]
  statusKnowledge: 'default' | 'explicit' | 'unknown'
  unavailableReason?: string
} {
  if (!argument)
    return {
      statusKnowledge: 'unknown',
      unavailableReason: 'ctx.setStatus has no statically known status',
    }
  if (ts.isNumericLiteral(argument))
    return { statusCodes: [Number(argument.text)], statusKnowledge: 'explicit' }
  if (
    ts.isConditionalExpression(argument) &&
    ts.isNumericLiteral(argument.whenTrue) &&
    ts.isNumericLiteral(argument.whenFalse)
  ) {
    const values = [
      ...new Set([Number(argument.whenTrue.text), Number(argument.whenFalse.text)]),
    ].toSorted((a, b) => a - b) as [number, ...number[]]
    return { statusCodes: values, statusKnowledge: 'explicit' }
  }
  return {
    statusKnowledge: 'unknown',
    unavailableReason: 'nearest ctx.setStatus value is dynamic',
  }
}
