import ts from '../contract-schema/typescript-api.mts'

/** Imported function declarations can still be reassigned in the module that owns them. */
export function hasFunctionBindingWrite(
  declaration: ts.FunctionDeclaration,
  checker: ts.TypeChecker,
): boolean {
  if (!declaration.name) return false
  const binding = checker.getSymbolAtLocation(declaration.name)
  let written = false
  const referencesBinding = (node: ts.Node): void => {
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
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) referencesBinding(node.initializer)
    node.forEachChild(inspect)
  }
  inspect(declaration.getSourceFile())
  return written
}
