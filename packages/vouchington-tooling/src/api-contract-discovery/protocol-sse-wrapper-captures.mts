import { selectedStaticSseClassCapability } from './protocol-sse-static-class-values.mts'
import ts from '../contract-schema/typescript-api.mts'
import { constructedContextCapture } from './protocol-http-context-literal-captures.mts'
import { methodAccess } from './protocol-http-method-access.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
} from './protocol-callback-values.mts'

/** Reached class fields and bound callable receivers retain their selected capabilities. */
export function selectedSseWrapperCapture(
  value: ts.Expression,
  checker: ts.TypeChecker,
  selected: (value: ts.Expression) => boolean,
): boolean {
  if (ts.isClassExpression(value))
    return selectedStaticSseClassCapability(
      value,
      selected,
      (fn) => isProtocolCallbackFunction(fn) && selectedSseCallableCapture(fn, selected),
    )
  if (ts.isNewExpression(value)) return constructedContextCapture(value, checker, selected)
  if (!ts.isCallExpression(value)) return false
  const method = methodAccess(unwrapExpression(value.expression))
  if (method?.name !== 'bind') return false
  const resolved = createProtocolCallbackValueResolver(checker).resolve(method.receiver, new Map())
  const fn = resolved?.node
  if (!fn || !isProtocolCallbackFunction(fn) || !fn.body) return false
  return selectedSseCallableCapture(fn, selected)
}

/** An opaque consumer can invoke an actual literal method or accessor body. */
export function selectedSseCallableCapture(
  fn: ts.FunctionLikeDeclaration,
  selected: (value: ts.Expression) => boolean,
): boolean {
  function captured(node: ts.Node): boolean {
    const value =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
        ? node.expression
        : node
    return (ts.isExpression(value) && selected(value)) || node.forEachChild(captured) === true
  }
  return fn.body !== undefined && captured(fn.body)
}
