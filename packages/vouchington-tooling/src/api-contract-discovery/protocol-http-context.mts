import ts from '../contract-schema/typescript-api.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
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
  const resolver = createProtocolCallbackValueResolver(checker)
  const calls: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && executableProtocolPath(node, checker)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(fn.getSourceFile())
  const registered = calls.some(
    (call) =>
      registeredHandler(call) &&
      call.arguments.some((argument) => resolver.resolve(argument, new Map())?.node === fn),
  )
  const callers = calls.filter((call) => {
    if (resolver.resolve(call.expression, new Map())?.node === fn) return true
    const owner = enclosingFunction(call)
    if (!owner) return false
    return calls.some((invocation) => {
      const target = resolver.resolve(invocation.expression, new Map())
      if (target?.node !== owner) return false
      const env = callbackArgumentBindings(
        owner,
        invocation,
        new Map(),
        target.env,
        checker,
        resolver,
      )
      return !!env && resolver.resolve(call.expression, env)?.node === fn
    })
  })
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
