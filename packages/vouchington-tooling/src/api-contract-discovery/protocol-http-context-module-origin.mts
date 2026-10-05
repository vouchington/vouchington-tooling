import ts from '../contract-schema/typescript-api.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

/** Namespace identity follows executable import origins, never an asserted module type. */
export function contextModuleOrigin(
  checker: ts.TypeChecker,
  binding: ts.Symbol | undefined,
  seen = new Set<ts.Symbol>(),
): ts.Symbol | undefined {
  if (!binding || seen.has(binding)) return undefined
  const symbol = binding.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(binding) : binding
  if (symbol.flags & ts.SymbolFlags.Module) return symbol
  const declaration = symbol.valueDeclaration
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  )
    return undefined
  let value = unwrapTransparentExpression(declaration.initializer)
  if (ts.isIdentifier(value))
    return contextModuleOrigin(
      checker,
      checker.getSymbolAtLocation(value),
      new Set(seen).add(binding),
    )
  if (!ts.isAwaitExpression(value)) return undefined
  value = unwrapTransparentExpression(value.expression)
  return ts.isCallExpression(value) &&
    value.expression.kind === ts.SyntaxKind.ImportKeyword &&
    value.arguments[0] &&
    ts.isStringLiteral(value.arguments[0])
    ? checker.getSymbolAtLocation(value.arguments[0])
    : undefined
}
