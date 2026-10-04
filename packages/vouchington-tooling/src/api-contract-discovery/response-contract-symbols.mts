import ts from '../contract-schema/typescript-api.mts'

export function functionSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return checker.getSymbolAtLocation(node.name)
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return checker.getSymbolAtLocation(node.parent.name)
  }
  return undefined
}

export function resolveSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}
