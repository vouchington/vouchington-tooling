import ts from '../contract-schema/typescript-api.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'

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
