import ts from '../contract-schema/typescript-api.mts'

/** Helper and factory parameter bindings must remain unchanged in their declaring source. */
export function hasBindingWrite(
  declaration: ts.FunctionDeclaration | ts.ParameterDeclaration,
  checker: ts.TypeChecker,
): boolean {
  if (!declaration.name) return false
  if (!ts.isIdentifier(declaration.name)) return true
  const binding = checker.getSymbolAtLocation(declaration.name)
  let written = false
  const referencesBinding = (node: ts.Node): void => {
    // Index expressions and computed property names read their keys, not write them.
    // inspect still visits these expressions separately to detect nested side-effect writes.
    if (ts.isComputedPropertyName(node)) return
    if (ts.isElementAccessExpression(node)) {
      referencesBinding(node.expression)
      return
    }
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === binding) written = true
    node.forEachChild(referencesBinding)
  }
  const inspect = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      referencesBinding(node.left)
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    )
      referencesBinding(node.operand)
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) referencesBinding(node.initializer)
    node.forEachChild(inspect)
  }
  inspect(declaration.getSourceFile())
  return written
}
