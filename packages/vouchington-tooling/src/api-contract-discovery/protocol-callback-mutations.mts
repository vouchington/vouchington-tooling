import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import type {
  CallbackBindings,
  createProtocolCallbackValueResolver,
} from './protocol-callback-values.mts'

export function callbackBindingReplaced(
  node: ts.Node,
  env: CallbackBindings,
  fn: ts.FunctionLikeDeclaration,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
): boolean {
  const { resolve, symbol } = resolver
  const write = ts.isDeleteExpression(node)
    ? node.expression
    : ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ? node.left
      : undefined
  if (!write) return false
  let root = unwrapExpression(write)
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root))
    root = unwrapExpression(root.expression)
  return (ts.isIdentifier(root) && env.has(symbol(root)!)) || resolve(write, env)?.node === fn
}
