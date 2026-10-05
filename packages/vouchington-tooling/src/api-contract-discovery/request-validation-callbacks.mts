import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { isConditionalPosition } from './request-validation-conditional.mts'
import { inlineFunction } from './request-validation-follow.mts'
import { propertyNameText } from './request-validation-keys.mts'
import { findConfig } from './request-validation-match.mts'
import type { ExecutedCallbackConfig } from './request-validation-types.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

/** The listed inline callback properties of a configured executed-callback host call. */
export function executedCallbackFunctions(
  call: ts.CallExpression,
  hosts: readonly ExecutedCallbackConfig[],
  checker: ts.TypeChecker,
): ts.FunctionLikeDeclaration[] {
  const host = findConfig(call.expression, hosts, checker)
  const argument = host && call.arguments[host.argument]
  const object = argument && unwrapTransparentExpression(argument)
  if (!host || !object || !ts.isObjectLiteralExpression(object)) return []
  return object.properties.flatMap((property) => {
    const name = propertyNameText(property.name)
    const callback = inlineFunction(
      ts.isPropertyAssignment(property) ? property.initializer : property,
    )
    return name !== undefined && host.properties.includes(name) && callback ? [callback] : []
  })
}

/**
 * True when some invocation of a callback runs it straight from a function the call enters, outside
 * any condition. Invocations elsewhere, such as in nested helpers, are treated as conditional.
 */
export function invokedUnconditionally(
  callers: readonly ts.CallExpression[],
  runners: ReadonlySet<ts.Node>,
): boolean {
  return callers.some(
    (caller) => !isConditionalPosition(caller) && runners.has(enclosingFunction(caller) as ts.Node),
  )
}
