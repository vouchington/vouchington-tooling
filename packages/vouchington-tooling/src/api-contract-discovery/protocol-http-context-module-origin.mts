import ts from '../contract-schema/typescript-api.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

/** Namespace identity follows executable import origins, never an asserted module type. */
export function contextModuleOrigin(
  checker: ts.TypeChecker,
  binding: ts.Symbol | undefined,
  seen = new Set<ts.Symbol>(),
  requiredModule?: (value: ts.Expression) => ts.Symbol | undefined,
): ts.Symbol | undefined {
  if (!binding || seen.has(binding)) return undefined
  const symbol = binding.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(binding) : binding
  if (symbol.flags & ts.SymbolFlags.Module) return symbol
  const declaration = symbol.valueDeclaration
  if (declaration && ts.isParameter(declaration) && ts.isIdentifier(declaration.name)) {
    const fn = declaration.parent
    const call = fn.parent
    if (
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      ts.isCallExpression(call) &&
      call.arguments[0] === fn &&
      fn.parameters[0] === declaration &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === 'then'
    ) {
      const imported = unwrapTransparentExpression(call.expression.expression)
      if (
        ts.isCallExpression(imported) &&
        imported.expression.kind === ts.SyntaxKind.ImportKeyword &&
        imported.arguments[0] &&
        ts.isStringLiteral(imported.arguments[0])
      )
        return checker.getSymbolAtLocation(imported.arguments[0])
    }
  }
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
      requiredModule,
    )
  if (!ts.isAwaitExpression(value)) return requiredModule?.(value)
  value = unwrapTransparentExpression(value.expression)
  return ts.isCallExpression(value) &&
    value.expression.kind === ts.SyntaxKind.ImportKeyword &&
    value.arguments[0] &&
    ts.isStringLiteral(value.arguments[0])
    ? checker.getSymbolAtLocation(value.arguments[0])
    : undefined
}
