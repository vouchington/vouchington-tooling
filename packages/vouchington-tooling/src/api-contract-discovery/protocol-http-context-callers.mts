import ts from '../contract-schema/typescript-api.mts'
import type { ProtocolCache } from './protocol-analysis-cache.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'

/** Use the same actual invocation sites for context admission and caller emission coverage. */
export function httpContextInvocations(
  fn: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
  cache?: ProtocolCache,
) {
  const resolver = createProtocolCallbackValueResolver(checker)
  const sourceFile = fn.getSourceFile()
  let calls = cache?.calls.get(sourceFile)
  if (!calls) {
    const found: ts.CallExpression[] = []
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && executableProtocolPath(node, checker, undefined, cache))
        found.push(node)
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    calls = found
    cache?.calls.set(sourceFile, calls)
  }
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
