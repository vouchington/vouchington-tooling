import ts from '../contract-schema/typescript-api.mts'
import { contextResponseMethod } from './protocol-http-context.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'

/** Branded metadata requires the dispatched response's body and status to remain intact. */
export function mutatedHttpResponse(
  node: ts.Node,
  response: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  const target = mutationTarget(node)
  if (!target) return false
  const receiver = expressionReceiver(target, checker)
  const field =
    receiver?.root === response
      ? receiver.path[0]
      : contextResponseMethod(unwrapExpression(target), response, checker, true)
  return (
    (field === 'body' || field === 'status') &&
    (executableProtocolPath(node, checker) || opaqueProtocolCallbackPath(node, checker))
  )
}

function mutationTarget(node: ts.Node): ts.Expression | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    return node.left
  if (ts.isDeleteExpression(node)) return node.expression
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  )
    return node.operand
  return undefined
}
