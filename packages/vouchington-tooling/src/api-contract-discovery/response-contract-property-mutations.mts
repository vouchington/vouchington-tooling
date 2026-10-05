import ts from '../contract-schema/typescript-api.mts'

import { attributionSymbol, resolveSymbol } from './response-contract-symbols.mts'
import { visit } from './response-contract-route-syntax.mts'

/** Direct syntactic property writes are excluded; indirect mutation is outside this proof. */
export function findMutatedProperties(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): Set<ts.Symbol> {
  const mutated = new Set<ts.Symbol>()
  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      let access: ts.PropertyAccessExpression | undefined
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isPropertyAccessExpression(node.left)
      )
        access = node.left
      else if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        ts.isPropertyAccessExpression(node.operand)
      )
        access = node.operand
      if (!access) return
      const symbol = checker.getSymbolAtLocation(access.name)
      if (symbol) mutated.add(attributionSymbol(resolveSymbol(symbol, checker), checker))
    })
  }
  return mutated
}
