import ts from '../contract-schema/typescript-api.mts'
import { contextResponseMethod } from './protocol-http-context.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'

const responseMethods = new Set([
  'setStatus',
  'pipeline',
  'json',
  'response',
  'response.buffer',
  'response.empty',
])

/** A feasible write through a canonical context alias invalidates response dispatch evidence. */
export function mutatesHttpResponseMethod(
  node: ts.Node,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  let target: ts.Expression | undefined
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    target = node.left
  if (ts.isDeleteExpression(node)) target = node.expression
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  )
    target = node.operand
  if (
    !target ||
    !responseMethods.has(
      contextResponseMethod(unwrapExpression(target), context, checker, true) ?? '',
    )
  )
    return false
  return executableProtocolPath(node, checker) || opaqueProtocolCallbackPath(node, checker)
}
