import ts from '../contract-schema/typescript-api.mts'

import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

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

export function attributionFunctionSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const existing = functionSymbol(node, checker)
  if (existing) return existing
  if (ts.isMethodDeclaration(node) && node.name) return checker.getSymbolAtLocation(node.name)
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const owner = wrappedFunctionOwner(node)
    if (
      owner &&
      (ts.isVariableDeclaration(owner) ||
        ts.isPropertyAssignment(owner) ||
        ts.isPropertyDeclaration(owner))
    ) {
      return checker.getSymbolAtLocation(owner.name)
    }
  }
  if (
    ts.isFunctionDeclaration(node) &&
    !node.name &&
    ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default
  )
    return defaultExportSymbol(node.getSourceFile(), checker)
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    isDefaultExportExpression(node)
  )
    return defaultExportSymbol(node.getSourceFile(), checker)
  return undefined
}

function wrappedFunctionOwner(
  node: ts.ArrowFunction | ts.FunctionExpression,
): ts.VariableDeclaration | ts.PropertyAssignment | ts.PropertyDeclaration | undefined {
  let current: ts.Node = node
  let parent = current.parent
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent)
  ) {
    current = parent
    parent = current.parent
  }
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.initializer === current
  )
    return parent
  return undefined
}

function isDefaultExportExpression(node: ts.ArrowFunction | ts.FunctionExpression): boolean {
  let current: ts.Expression = node
  let parent = current.parent
  while (
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)) &&
    parent.expression === current
  ) {
    current = parent
    parent = current.parent
  }
  return ts.isExportAssignment(parent) && !parent.isExportEquals && parent.expression === current
}

function defaultExportSymbol(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  return (
    moduleSymbol &&
    checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.getName() === 'default')
  )
}

export function resolveSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

export function attributionSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  const resolved = resolveSymbol(symbol, checker)
  const name = (resolved.valueDeclaration as ts.NamedDeclaration | undefined)?.name
  if (!name || !ts.isIdentifier(name)) return resolved
  return checker.getSymbolAtLocation(name) ?? resolved
}

export function propertyImplementationSymbol(
  access: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const contextual = checker.getSymbolAtLocation(access.name)
  const receiver = unwrapTransparentExpression(access.expression)
  if (!contextual || !ts.isIdentifier(receiver)) return contextual
  const receiverSymbol = checker.getSymbolAtLocation(receiver)
  const declaration = receiverSymbol?.valueDeclaration
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
    return contextual
  const initializer = unwrapTransparentExpression(declaration.initializer)
  if (!ts.isObjectLiteralExpression(initializer)) return contextual
  if (initializer.properties.some(ts.isSpreadAssignment)) return contextual
  const implementation = initializer.properties.find((property) => {
    // Every non-spread object-literal member has a name; spread members were excluded above.
    const name = property.name!
    return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === access.name.text
  })
  return (implementation?.name && checker.getSymbolAtLocation(implementation.name)) || contextual
}
