import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import {
  httpContextArgument,
  contextResponseMethod,
  wrappedHttpContextArgument,
} from './protocol-http-context.mts'
import {
  isProtocolCallbackFunction,
  type CallbackBindings,
  type createProtocolCallbackValueResolver,
} from './protocol-callback-values.mts'

/** Foreign callable consumers retain literal callbacks that capture the selected context. */
export function opaqueWrappedHttpContextArgument(
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
  env: CallbackBindings,
): boolean {
  if (call.arguments.some((argument) => wrappedHttpContextArgument(argument, context, checker)))
    return true
  function captures(argument: ts.Expression): boolean {
    const fn = unwrapExpression(argument)
    if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false
    let found = false
    function visit(node: ts.Node) {
      if (ts.isExpression(node)) {
        if (httpContextArgument(node, context, checker)) found = true
        const method = contextResponseMethod(node, context, checker, true)
        if (
          method &&
          (['json', 'pipeline', 'setStatus'].includes(method) || method.startsWith('response.'))
        )
          found = true
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return
      ts.forEachChild(node, visit)
    }
    visit(fn.body)
    return found
  }
  const indices = call.arguments.flatMap((argument, index) => (captures(argument) ? [index] : []))
  if (!indices.length) return false
  const target = resolver.resolve(call.expression, env)?.node
  if (!target || !isProtocolCallbackFunction(target) || !target.body) return true
  const parameters = runtimeParameters(target)
  return indices.some((index) => {
    const parameter = parameters[index]
    if (!parameter || !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken) return true
    const symbol = checker.getSymbolAtLocation(parameter.name)
    let used = false
    function visit(node: ts.Node) {
      if (
        ts.isIdentifier(node) &&
        (node.text === 'arguments' || checker.getSymbolAtLocation(node) === symbol)
      )
        used = true
      ts.forEachChild(node, visit)
    }
    visit(target.body!)
    return used
  })
}
