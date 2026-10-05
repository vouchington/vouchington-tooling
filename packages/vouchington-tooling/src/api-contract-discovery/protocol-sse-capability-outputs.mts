import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'

/** A reached callable exposes its own returned values and executable generator yields. */
export function sseCapabilityOutputs(
  fn: ts.FunctionLikeDeclaration,
): (ts.Expression | undefined)[] {
  const values = returnedExpressions(fn)
  function collect(node: ts.Node): void {
    if (ts.isFunctionLike(node)) return
    if (ts.isYieldExpression(node) && node.expression && potentiallyExecuted(node))
      values.push(node.expression)
    node.forEachChild(collect)
  }
  if (fn.asteriskToken && fn.body) collect(fn.body)
  return values
}
