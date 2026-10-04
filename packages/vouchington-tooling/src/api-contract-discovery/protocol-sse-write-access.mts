import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

type WriteAccess = { receiver: ts.Expression; method: string | undefined }
type WriteInvocation = Omit<WriteAccess, 'receiver'> & {
  receiver: ts.Expression | undefined
  rawBytes: boolean
}

/** Resolves direct and Function.call/apply SSE writes without losing their actual receiver. */
export function sseWriteInvocation(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): WriteInvocation | undefined {
  const access = writeAccess(call.expression)
  if (!access) return undefined
  if (access.method === 'pipe')
    return call.arguments[0]
      ? { receiver: call.arguments[0], method: 'write', rawBytes: true }
      : undefined
  if (access.method === 'bind') {
    const target = writeAccess(access.receiver)
    if (target?.method !== 'write' && target?.method !== 'end') return undefined
    return { receiver: call.arguments[0], method: target.method, rawBytes: true }
  }
  if (access.method !== 'call' && access.method !== 'apply')
    return { ...access, rawBytes: hasRawBytes(access.method, call.arguments, checker, false) }

  const target = writeAccess(access.receiver)
  // The first call/apply argument supplies the method's actual `this` receiver.
  const receiver = call.arguments[0]
  if (!receiver) return undefined
  const payload = indirectPayload(access.method, call, checker)
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

function writeAccess(expression: ts.Expression): WriteAccess | undefined {
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

function indirectPayload(
  method: 'call' | 'apply',
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): readonly ts.Expression[] | undefined {
  if (method === 'call') return call.arguments.slice(1)
  const argument = call.arguments[1]
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

function hasRawBytes(
  method: string | undefined,
  payload: readonly ts.Expression[] | undefined,
  checker: ts.TypeChecker,
  indirect: boolean,
): boolean {
  // Unknown apply payloads can contain bytes. Unknown computed methods can emit them too.
  if (payload === undefined || method === undefined) return true
  if (method === 'write') return !indirect || payload.length > 0
  if (method !== 'end' || !payload[0]) return false
  const type = checker.getTypeAtLocation(payload[0])
  return (
    !(type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) &&
    type.getCallSignatures().length === 0
  )
}
