import ts from '../contract-schema/typescript-api.mts'
import { httpContextInvocations } from './protocol-http-context-callers.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'

/** A helper parameter is a response context only when every executable caller passes one. */
export function httpHandlerContext(
  fn: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
  active = new Set<ts.FunctionLikeDeclaration>(),
): ts.Symbol | undefined {
  if (active.has(fn)) return undefined
  const parameter = runtimeParameters(fn)[0]
  const context =
    parameter && ts.isIdentifier(parameter.name)
      ? checker.getSymbolAtLocation(parameter.name)
      : undefined
  if (!context || hasBindingWrite(parameter!, checker)) return undefined
  const { registered, callers } = httpContextInvocations(fn, checker)
  const next = new Set(active).add(fn)
  const valid =
    (registered || callers.length > 0) &&
    callers.every((call) => {
      const argument = call.arguments[0]
      const receiver = argument && expressionReceiver(argument, checker)
      const declaration = receiver?.root.valueDeclaration
      const owner =
        declaration && ts.isParameter(declaration) ? enclosingFunction(declaration) : undefined
      return (
        !!owner &&
        !!receiver &&
        receiver.path.length === 0 &&
        !receiver.mutableAlias &&
        receiver.root === httpHandlerContext(owner, checker, next)
      )
    })
  const result = valid ? context : undefined
  return result
}

/** Literal bracket access is equivalent to property access for response methods. */
export function contextResponseMethod(
  expression: ts.Expression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  allowMutable = false,
): string | undefined {
  const access = methodAccess(expression)
  if (!access) return undefined
  const receiver =
    expressionReceiver(access.receiver, checker) ??
    bracketResponseReceiver(access.receiver, checker)
  if (receiver?.root !== context || (receiver.mutableAlias && !allowMutable)) return undefined
  if (receiver.path.length === 0) return access.name
  if (receiver.path.length === 1 && receiver.path[0] === 'response')
    return `response.${access.name}`
  return undefined
}

function methodAccess(expression: ts.Expression) {
  if (ts.isPropertyAccessExpression(expression))
    return { receiver: expression.expression, name: expression.name.text }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression))
    return { receiver: expression.expression, name: expression.argumentExpression.text }
  return undefined
}

function bracketResponseReceiver(expression: ts.Expression, checker: ts.TypeChecker) {
  const access = methodAccess(expression)
  if (!access || access.name !== 'response') return undefined
  const receiver = expressionReceiver(access.receiver, checker)
  return receiver && { ...receiver, path: [...receiver.path, 'response'] }
}

/** Follow only caller contexts already admitted by the actual-argument proof. */
export function httpContextScopes(fn: ts.FunctionLikeDeclaration, checker: ts.TypeChecker) {
  const scopes = new Map<ts.FunctionLikeDeclaration, ts.Symbol>()
  const pending = [fn]
  const seen = new Set<ts.FunctionLikeDeclaration>()
  while (pending.length) {
    const current = pending.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    const context = httpHandlerContext(current, checker)
    if (!context) continue
    scopes.set(current, context)
    for (const call of httpContextInvocations(current, checker).callers) {
      // Admission above proves every caller's parameter-owned context.
      const receiver = expressionReceiver(call.arguments[0]!, checker)!
      pending.push(enclosingFunction(receiver.root.valueDeclaration!)!)
    }
  }
  return scopes
}

/** Indirect methods cannot prove the declared status or body, including borrowed this receivers. */
export function indirectHttpResponseMethod(
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
) {
  const outer = methodAccess(call.expression)
  if (!outer || !['call', 'apply', 'bind'].includes(outer.name)) return undefined
  const direct = contextResponseMethod(outer.receiver, context, checker, true)
  if (direct) return direct
  const method = expressionReceiver(outer.receiver, checker)
  if (method?.root === context)
    return method.path[0] === 'response' ? method.path.slice(0, 2).join('.') : method.path[0]
  const receiver = call.arguments[0] && expressionReceiver(call.arguments[0], checker)
  if (receiver?.root !== context) return undefined
  const target = methodAccess(outer.receiver)
  const name = target?.name ?? method?.path.at(-1)
  if (!name) return undefined
  return receiver.path.length === 0
    ? name
    : receiver.path.length === 1 && receiver.path[0] === 'response'
      ? `response.${name}`
      : undefined
}
