import ts from '../contract-schema/typescript-api.mts'

export function symbolBindingWritten(
  source: ts.SourceFile,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  includeMembers = false,
): boolean {
  const references = (node: ts.Node): boolean => {
    if (!includeMembers && ts.isComputedPropertyName(node)) return false
    if (
      !includeMembers &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    )
      return false
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol) return true
    return node.getChildren().some(references)
  }
  let written = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      references(node.left)
    )
      written = true
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && references(node.initializer))
      written = true
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      references(node.operand)
    )
      written = true
    if (!written) node.forEachChild(visit)
  }
  visit(source)
  return written
}
