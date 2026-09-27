import ts from '../contract-schema/typescript-api.mts'

import { isContextMethod } from './response-contract-route-analysis.mts'

/**
 * Detects the request-contract markers in the version-one route convention.
 * Kept out of `responseMarker` (which only recognizes `apiResponse`/`apiNoContent`) so the two
 * AST walks never interfere — see `response-contract-route-analysis.mts` for the response side.
 */
export function requestMarker(
  expression: ts.Expression,
): 'apiRequest' | 'apiRequestContract' | 'apiNoRequestBody' | undefined {
  if (!ts.isIdentifier(expression)) return undefined
  if (
    expression.text === 'apiRequest' ||
    expression.text === 'apiRequestContract' ||
    expression.text === 'apiNoRequestBody'
  )
    return expression.text
  return undefined
}

/**
 * Detects `ctx.request.json(...)`: a two-level nested access (`ctx.request` then `.json`) that
 * `isContextMethod`'s single-level match can't see through directly — mirrors
 * `isContextResponseBufferCall`'s own two-level pattern on the response side.
 */
export function isContextRequestJsonCall(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'json') return false
  return isContextMethod(expression.expression, 'request')
}

/** Detects `ctx.request.buffer(...)`: a raw request body whose shape can't be statically extracted. */
export function isContextRequestBufferCall(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'buffer') return false
  return isContextMethod(expression.expression, 'request')
}

/**
 * Walks up from a `ctx.request.json(...)` call expression to find the enclosing `as T` cast that
 * gives it a static type, unwrapping the wrapper shapes real call sites use in between:
 * `(await ctx.request.json(...)) as T` and the `.catch()`-guarded
 * `(await ctx.request.json(...).catch(() => ({}))) as T`.
 * Returns `undefined` when no enclosing cast exists (e.g. the read feeds directly into another
 * call, `parseFoo(await ctx.request.json())`) — the caller treats that as an honest untyped
 * success, not a failure.
 */
export function enclosingRequestBodyCast(call: ts.CallExpression): ts.AsExpression | undefined {
  let current: ts.Node = call
  while (true) {
    const parent: ts.Node | undefined = current.parent
    if (!parent) return undefined
    if (ts.isParenthesizedExpression(parent) && parent.expression === current) {
      current = parent
      continue
    }
    if (ts.isAwaitExpression(parent) && parent.expression === current) {
      current = parent
      continue
    }
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.name.text === 'catch' &&
      parent.expression === current &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent
    ) {
      current = parent.parent
      continue
    }
    if (ts.isAsExpression(parent) && parent.expression === current) return parent
    return undefined
  }
}
