import ts from '../contract-schema/typescript-api.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'

export function hasStableBinding(declaration: ts.Declaration, checker: ts.TypeChecker): boolean {
  if (ts.isVariableDeclaration(declaration))
    return (
      ts.isVariableDeclarationList(declaration.parent) &&
      !!(declaration.parent.flags & ts.NodeFlags.Const)
    )
  return !ts.isFunctionDeclaration(declaration) || !hasBindingWrite(declaration, checker)
}

export function unwrapHandlerExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression
  return node
}
