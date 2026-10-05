import ts from '../contract-schema/typescript-api.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'

/** Missing arguments execute the concrete implementation's parameter initializers. */
export function createContextForwardedArguments(checker: ts.TypeChecker) {
  const cache = new Map<ts.CallExpression | ts.NewExpression, readonly ts.Expression[]>()
  return (call: ts.CallExpression | ts.NewExpression): readonly ts.Expression[] => {
    const hit = cache.get(call)
    if (hit) return hit
    const arguments_ = [...(call.arguments ?? [])]
    const implementation = checker.getResolvedSignature(call)?.declaration
    if (implementation && isProtocolCallbackFunction(implementation) && implementation.body)
      for (const [index, parameter] of runtimeParameters(implementation).entries())
        if (!arguments_[index] && parameter.initializer) arguments_[index] = parameter.initializer
    cache.set(call, arguments_)
    return arguments_
  }
}

/** Source stability establishes this target before caller-specific receiver obligations run. */
export function contextForwardedTarget(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
  index: number,
): { implementation: ts.FunctionLikeDeclaration; binding: ts.Symbol } | undefined {
  const implementation = checker.getResolvedSignature(call)?.declaration
  if (!implementation || !isProtocolCallbackFunction(implementation) || !implementation.body)
    return undefined
  const parameter = runtimeParameters(implementation)[index]
  const binding =
    parameter && ts.isIdentifier(parameter.name) && checker.getSymbolAtLocation(parameter.name)
  return binding ? { implementation, binding } : undefined
}
