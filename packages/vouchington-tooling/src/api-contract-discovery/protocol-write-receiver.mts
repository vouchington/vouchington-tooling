import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

export type WriteReceiver = { root: ts.Symbol; path: readonly string[] }

export function writeReceiver(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): WriteReceiver | undefined {
  const target = unwrapExpression(call.expression)
  if (!ts.isPropertyAccessExpression(target) || target.name.text !== 'write') return undefined
  return resolveReceiver(target.expression, checker)
}

export function sameWriteReceiver(left: WriteReceiver, right: WriteReceiver | undefined): boolean {
  return (
    right !== undefined &&
    left.root === right.root &&
    left.path.length === right.path.length &&
    left.path.every((part, index) => part === right.path[index])
  )
}

function resolveReceiver(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): WriteReceiver | undefined {
  const value = unwrapExpression(expression)
  if (ts.isIdentifier(value)) {
    const symbol = checker.getSymbolAtLocation(value)
    if (!symbol) return undefined
    return {
      root: symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
      path: [],
    }
  }
  if (!ts.isPropertyAccessExpression(value)) return undefined
  const parent = resolveReceiver(value.expression, checker)
  return parent ? { root: parent.root, path: [...parent.path, value.name.text] } : undefined
}
