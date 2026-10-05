import ts from '../contract-schema/typescript-api.mts'
import { yieldsBoundHttpContext } from './protocol-http-context-bound-nodes.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
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
  call: { expression: ts.Expression; arguments: readonly ts.Expression[] },
  context: ts.Symbol,
  checker: ts.TypeChecker,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
  env: CallbackBindings,
  safeCapture: (fn: ts.FunctionLikeDeclaration) => boolean,
  argumentOffset = 0,
): boolean {
  if (call.arguments.some((argument) => wrappedHttpContextArgument(argument, context, checker)))
    return true
  function captures(argument: ts.Expression): boolean {
    const value = unwrapExpression(argument)
    if (ts.isCallExpression(value)) {
      const generator = resolver.resolve(value.expression, env)?.node
      return (
        !!generator &&
        isProtocolCallbackFunction(generator) &&
        yieldsBoundHttpContext(generator, context, checker)
      )
    }
    const fn = resolver.resolve(argument, env)?.node ?? value
    if (!isProtocolCallbackFunction(fn) || !fn.body) return false
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
    if (!found) return false
    const returned = returnedExpressions(fn).some(
      (value) =>
        !!value &&
        (httpContextArgument(value, context, checker) ||
          wrappedHttpContextArgument(value, context, checker) ||
          !!contextResponseMethod(value, context, checker, true)),
    )
    return returned || runtimeParameters(fn).length > 0 || !safeCapture(fn)
  }
  const indices = call.arguments.flatMap((argument, index) => (captures(argument) ? [index] : []))
  if (!indices.length) return false
  const target = resolver.resolve(call.expression, env)?.node
  if (!target || !isProtocolCallbackFunction(target) || !target.body) return true
  const parameters = runtimeParameters(target)
  return indices.some((index) => {
    const parameter = parameters[index + argumentOffset]
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

/** Tags have a template-string argument before the actual substitution expressions. */
export function opaqueWrappedHttpContextTag(
  tag: ts.TaggedTemplateExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
  env: CallbackBindings,
  safeCapture: (fn: ts.FunctionLikeDeclaration) => boolean,
): boolean {
  return (
    ts.isTemplateExpression(tag.template) &&
    opaqueWrappedHttpContextArgument(
      { expression: tag.tag, arguments: tag.template.templateSpans.map((span) => span.expression) },
      context,
      checker,
      resolver,
      env,
      safeCapture,
      1,
    )
  )
}
