import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

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
  if (ts.isIdentifier(value)) {
    const symbol = checker.getSymbolAtLocation(value)
    if (!symbol) return undefined
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
  if (!ts.isPropertyAccessExpression(value)) return undefined
  const parent = expressionReceiver(value.expression, checker, active)
  return parent ? { ...parent, path: [...parent.path, value.name.text] } : undefined
}
