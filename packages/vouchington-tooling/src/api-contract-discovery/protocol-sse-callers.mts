import ts from '../contract-schema/typescript-api.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import {
  enclosingRouteBinding,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'

export function sseCallerScope(
  functions: readonly ts.FunctionLikeDeclaration[],
  calls: readonly ts.CallExpression[],
  binding: RouteBinding,
  bindings: HandlerBindings,
  checker: ts.TypeChecker,
) {
  const resolver = createProtocolCallbackValueResolver(checker)
  const matches = calls.flatMap((call) => {
    const fn = resolver.resolve(call.expression, new Map())?.node
    if (
      !fn ||
      !functions.includes(fn as ts.FunctionLikeDeclaration) ||
      !executableProtocolPath(call, checker)
    )
      return []
    const route = enclosingRouteBinding(call, checker, bindings, false)
    return route?.method === binding.method && route.routeTemplate === binding.routeTemplate
      ? [{ call, fn: fn as ts.FunctionLikeDeclaration }]
      : []
  })
  if (!matches.length) return undefined
  const contexts = new Set<ts.Symbol>()
  const callerFunctions = new Set<ts.FunctionLikeDeclaration>()
  const paths = matches.map(({ call }) => {
    const anchors: (ts.CallExpression | ts.NewExpression)[] = [call]
    let fn = enclosingFunction(call)
    let outer = fn
    while (fn) {
      callerFunctions.add(fn)
      let value: ts.Node = fn
      while (ts.isPropertyAssignment(value.parent) || ts.isObjectLiteralExpression(value.parent))
        value = value.parent
      if (ts.isCallExpression(value.parent) || ts.isNewExpression(value.parent))
        anchors.push(value.parent)
      outer = fn
      fn = enclosingFunction(fn)
    }
    const name = outer && runtimeParameters(outer)[0]?.name
    const context = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
    if (
      !outer ||
      (name && !context) ||
      !calls.some(
        (node) =>
          registeredHandler(node) &&
          node.arguments.some((argument) => resolver.resolve(argument, new Map())?.node === outer),
      )
    )
      throw new Error('SSE helper must bind a registered caller context')
    if (context) contexts.add(context)
    return anchors
  })
  if (contexts.size > 1) throw new Error('SSE helper has ambiguous caller contexts')
  const context = [...contexts][0]
  for (const { call, fn } of matches)
    runtimeParameters(fn).forEach((parameter, index) => {
      const argument = call.arguments[index]
      const receiver = argument && expressionReceiver(argument, checker)
      if (
        context &&
        receiver?.root === context &&
        receiver.path.length === 0 &&
        !receiver.mutableAlias &&
        ts.isIdentifier(parameter.name)
      ) {
        contexts.add(checker.getSymbolAtLocation(parameter.name)!)
      }
    })
  return { paths, contexts, functions: [...callerFunctions] }
}
