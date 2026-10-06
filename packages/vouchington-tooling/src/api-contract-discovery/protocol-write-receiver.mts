import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'

export type WriteReceiver = { root: ts.Symbol; path: readonly string[]; mutableAlias?: boolean }

export function writeReceiver(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): WriteReceiver | undefined {
  const target = unwrapExpression(call.expression)
  if (!ts.isPropertyAccessExpression(target) || target.name.text !== 'write') return undefined
  return expressionReceiver(target.expression, checker)
}

export function sameWriteReceiver(left: WriteReceiver, right: WriteReceiver | undefined): boolean {
  return (
    right !== undefined &&
    left.root === right.root &&
    left.path.length === right.path.length &&
    left.path.every((part, index) => part === right.path[index])
  )
}

export function expressionReceiver(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  active = new Set<ts.Symbol>(),
): WriteReceiver | undefined {
  const value = unwrapExpression(expression)
  if (value.kind === ts.SyntaxKind.ThisKeyword) {
    let owner = enclosingFunction(value)
    while (owner && ts.isArrowFunction(owner)) owner = enclosingFunction(owner)
    const parameter = owner?.parameters.find(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === 'this',
    )
    const symbol = parameter && checker.getSymbolAtLocation(parameter.name)
    return symbol ? { root: symbol, path: [] } : undefined
  }
  if (ts.isIdentifier(value)) {
    const symbol = checker.getSymbolAtLocation(value)
    if (!symbol) return undefined
    return symbolReceiver(symbol, checker, active)
  }
  if (!ts.isPropertyAccessExpression(value)) return undefined
  const propertySymbol = checker.getSymbolAtLocation(value.name)
  if (propertySymbol && active.has(propertySymbol)) return undefined
  const property = literalProperty(value, checker) ?? propertySymbol?.valueDeclaration
  const propertyActive = new Set(active)
  if (propertySymbol) propertyActive.add(propertySymbol)
  // Object literal properties remain writable even when their variable is const.
  // Track the original receiver for raw-write rejection; never trust a marked wrapper.
  if (property && ts.isPropertyAssignment(property)) {
    const receiver = expressionReceiver(property.initializer, checker, propertyActive)
    return receiver && { ...receiver, mutableAlias: true }
  }
  if (property && ts.isShorthandPropertyAssignment(property)) {
    const symbol = checker.getShorthandAssignmentValueSymbol(property)
    const receiver = symbol && symbolReceiver(symbol, checker, propertyActive)
    return receiver && { ...receiver, mutableAlias: true }
  }
  const parent = expressionReceiver(value.expression, checker, active)
  return parent ? { ...parent, path: [...parent.path, value.name.text] } : undefined
}

function symbolReceiver(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  active: Set<ts.Symbol>,
): WriteReceiver | undefined {
  const root = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  if (active.has(root)) return undefined
  const declaration = root.valueDeclaration
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    ts.isVariableDeclarationList(declaration.parent)
  ) {
    const initializer = unwrapExpression(declaration.initializer)
    if (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer)) {
      const receiver = expressionReceiver(initializer, checker, new Set(active).add(root))
      return (
        receiver && {
          ...receiver,
          ...(!(declaration.parent.flags & ts.NodeFlags.Const) ? { mutableAlias: true } : {}),
        }
      )
    }
  }
  return { root, path: [] }
}

function literalProperty(value: ts.PropertyAccessExpression, checker: ts.TypeChecker) {
  const base = unwrapExpression(value.expression)
  if (!ts.isIdentifier(base)) return undefined
  const declaration = checker.getSymbolAtLocation(base)?.valueDeclaration
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
    return undefined
  const initializer = unwrapExpression(declaration.initializer)
  if (!ts.isObjectLiteralExpression(initializer)) return undefined
  return initializer.properties.find(
    (member) =>
      (ts.isPropertyAssignment(member) || ts.isShorthandPropertyAssignment(member)) &&
      ts.isIdentifier(member.name) &&
      member.name.text === value.name.text,
  )
}
