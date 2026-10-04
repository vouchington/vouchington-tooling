import ts from '../contract-schema/typescript-api.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'

/** Use the same actual invocation sites for context admission and caller emission coverage. */
export function httpContextInvocations(fn: ts.FunctionLikeDeclaration, checker: ts.TypeChecker) {
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
  return { registered, callers }
}
