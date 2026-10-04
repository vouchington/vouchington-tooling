import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

export type WriteAccess = { receiver: ts.Expression; method: string | undefined }
export type WriteInvocation = {
  receiver: ts.Expression | undefined
  method: string | undefined
  rawBytes: boolean
}

export function writeAccess(expression: ts.Expression): WriteAccess | undefined {
  expression = unwrapExpression(expression)
  if (ts.isPropertyAccessExpression(expression))
    return { receiver: expression.expression, method: expression.name.text }
  if (!ts.isElementAccessExpression(expression)) return undefined
  const method = unwrapExpression(expression.argumentExpression)
  return {
    receiver: expression.expression,
    method: ts.isStringLiteralLike(method) ? method.text : undefined,
  }
}

export function reflectApplyInvocation(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): WriteInvocation | undefined {
  const expression = unwrapExpression(call.expression)
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== 'apply' ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== 'Reflect'
  )
    return undefined
  const defaultApply = checker
    .getSymbolAtLocation(expression.name)
    ?.declarations?.some((declaration) =>
      declaration.getSourceFile().fileName.endsWith('/lib.es2015.reflect.d.ts'),
    )
  if (!defaultApply) return undefined
  const target = call.arguments[0] && writeAccess(call.arguments[0])
  const receiver = call.arguments[1]
  const payload = applyPayload(call.arguments[2], checker)
  if (target?.method === 'pipe') {
    const destination = payload?.[0]
    return {
      receiver: destination,
      method: 'write',
      rawBytes: payload === undefined || destination !== undefined,
    }
  }
  const method = target?.method === 'write' || target?.method === 'end' ? target.method : undefined
  return {
    receiver,
    method,
    rawBytes: payload === undefined || hasRawBytes(method, payload, checker, true),
  }
}

export function indirectPayload(
  method: 'call' | 'apply',
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): readonly ts.Expression[] | undefined {
  if (method === 'call') return call.arguments.slice(1)
  return applyPayload(call.arguments[1], checker)
}

function applyPayload(
  argument: ts.Expression | undefined,
  checker: ts.TypeChecker,
): readonly ts.Expression[] | undefined {
  if (!argument) return []
  const value = unwrapExpression(argument)
  if (isNullish(argument, checker)) return []
  if (!ts.isArrayLiteralExpression(value) || value.elements.some(ts.isSpreadElement))
    return undefined
  return value.elements.filter(ts.isExpression)
}

function isNullish(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const value = unwrapExpression(expression)
  if (value.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isIdentifier(value) && value.text === 'undefined') return true
  const flags = checker.getTypeAtLocation(expression).flags
  return !!(flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))
}

export function hasRawBytes(
  method: string | undefined,
  payload: readonly ts.Expression[] | undefined,
  checker: ts.TypeChecker,
  indirect: boolean,
): boolean {
  if (payload === undefined || method === undefined) return true
  if (method === 'write') return !indirect || payload.length > 0
  if (method !== 'end' || !payload[0]) return false
  const type = checker.getTypeAtLocation(payload[0])
  return (
    !(type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) &&
    type.getCallSignatures().length === 0
  )
}
