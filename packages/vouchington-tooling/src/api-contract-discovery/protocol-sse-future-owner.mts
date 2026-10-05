import ts from '../contract-schema/typescript-api.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import type { WriteReceiver } from './protocol-write-receiver.mts'

/** Temporal allocation does not prevent a retained callback from reading the owner later. */
export function argumentMayReachFutureOwner(
  actual: WriteReceiver,
  selected: WriteReceiver,
  checker: ts.TypeChecker,
): boolean {
  const selectedDeclaration = selected.root.valueDeclaration
  const owner = selectedDeclaration && enclosingFunction(selectedDeclaration)
  if (!owner) return true
  const declaration = actual.root.valueDeclaration
  const scope =
    declaration && ts.isFunctionDeclaration(declaration)
      ? declaration.body
      : declaration && ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : undefined
  if (!scope) {
    const type = declaration && checker.getTypeOfSymbolAtLocation(actual.root, declaration)
    return (
      !!type && (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0)
    )
  }
  const mayReachOwner = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) {
      if (checker.getSymbolAtLocation(node) === selected.root) return true
      const root = expressionReceiver(node, checker)?.root.valueDeclaration
      if (root && ts.isVariableDeclaration(root) && enclosingFunction(root) === owner) {
        const initializer = root.initializer && unwrapExpression(root.initializer)
        // A local container can retain a future-owner callback; existing receiver facts resolve const aliases.
        if (
          initializer &&
          (ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer))
        )
          return true
      }
      // Local callables can capture this binding; imported/global functions cannot capture it.
      const type = checker.getTypeAtLocation(node)
      if (type.getCallSignatures().length || type.getConstructSignatures().length) {
        const symbol = checker.getSymbolAtLocation(node)
        const resolved =
          symbol &&
          (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
        const callable = resolved?.valueDeclaration
        if (!callable || enclosingFunction(callable) === owner) return true
      }
    }
    return node.forEachChild(mayReachOwner) === true
  }
  return mayReachOwner(scope)
}
