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
  if (ts.isNewExpression(value)) return constructedContextCapture(value, checker, selected)
  if (!ts.isCallExpression(value)) return false
  const method = methodAccess(unwrapExpression(value.expression))
  if (method?.name !== 'bind') return false
  const resolved = createProtocolCallbackValueResolver(checker).resolve(method.receiver, new Map())
  const fn = resolved?.node
  if (!fn || !isProtocolCallbackFunction(fn) || !fn.body) return false
  function captured(node: ts.Node): boolean {
    return (ts.isExpression(node) && selected(node)) || node.forEachChild(captured) === true
  }
  return captured(fn.body)
}
