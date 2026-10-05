import ts from '../contract-schema/typescript-api.mts'
import type { ProtocolCache } from './protocol-analysis-cache.mts'

/** Every symbol assigned, updated, or looped over in the source file, found in one scan. */
function writtenSymbols(sourceFile: ts.SourceFile, checker: ts.TypeChecker) {
  const written = new Set<ts.Symbol | undefined>()
  const referencesBinding = (node: ts.Node): void => {
    // Index expressions and computed property names read their keys, not write them.
    // inspect still visits these expressions separately to detect nested side-effect writes.
    if (ts.isComputedPropertyName(node)) return
    if (ts.isElementAccessExpression(node)) {
      referencesBinding(node.expression)
      return
    }
    if (ts.isIdentifier(node)) written.add(checker.getSymbolAtLocation(node))
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
  inspect(sourceFile)
  return written
}

/** Helper and factory parameter bindings must remain unchanged in their declaring source. */
export function hasBindingWrite(
  declaration: ts.FunctionDeclaration | ts.ParameterDeclaration,
  checker: ts.TypeChecker,
  cache?: ProtocolCache,
): boolean {
  if (!declaration.name) return false
  if (!ts.isIdentifier(declaration.name)) return true
  const sourceFile = declaration.getSourceFile()
  let written = cache?.writtenSymbols.get(sourceFile)
  if (!written) {
    written = writtenSymbols(sourceFile, checker)
    cache?.writtenSymbols.set(sourceFile, written)
  }
  return written.has(checker.getSymbolAtLocation(declaration.name))
}
