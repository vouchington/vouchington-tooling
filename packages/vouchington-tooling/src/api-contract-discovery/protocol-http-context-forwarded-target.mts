import ts from '../contract-schema/typescript-api.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'

/** Missing arguments execute the concrete implementation's parameter initializers. */
export function createContextForwardedArguments(checker: ts.TypeChecker) {
  const cache = new Map<ts.CallExpression | ts.NewExpression, readonly ts.Expression[]>()
  return (call: ts.CallExpression | ts.NewExpression): readonly ts.Expression[] => {
    const hit = cache.get(call)
    if (hit) return hit
    const implementation = checker.getResolvedSignature(call)?.declaration
    const arguments_ =
      implementation && isProtocolCallbackFunction(implementation) && implementation.body
        ? contextEffectiveArguments(implementation, call, checker)
        : [...(call.arguments ?? [])]
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

/** Only omitted or intrinsic undefined arguments select the actual parameter initializer. */
export function contextEffectiveArguments(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
): ts.Expression[] {
  const args = [...(call.arguments ?? [])]
  if (args.some(ts.isSpreadElement)) return args
  for (const [index, parameter] of runtimeParameters(fn).entries()) {
    const value = args[index] && unwrapExpression(args[index])
    if (
      parameter.initializer &&
      (!value ||
        (ts.isIdentifier(value) &&
          value.text === 'undefined' &&
          !checker.getSymbolAtLocation(value)?.valueDeclaration))
    )
      args[index] = parameter.initializer
  }
  return args
}
