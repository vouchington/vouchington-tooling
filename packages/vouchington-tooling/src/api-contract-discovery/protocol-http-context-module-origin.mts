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
    const imported = fulfillmentModule(checker, declaration)
    if (imported) return imported
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

/** Destructured fulfillment bindings retain the actual module export, rather than a local root. */
export function contextImportBindingMember(checker: ts.TypeChecker, binding?: ts.Symbol) {
  const declaration = binding?.valueDeclaration
  if (
    !declaration ||
    !ts.isBindingElement(declaration) ||
    declaration.dotDotDotToken ||
    !ts.isObjectBindingPattern(declaration.parent)
  )
    return undefined
  const parameter = declaration.parent.parent
  const key = declaration.propertyName ?? declaration.name
  if (!ts.isParameter(parameter) || !(ts.isIdentifier(key) || ts.isStringLiteral(key)))
    return undefined
  const module = fulfillmentModule(checker, parameter)
  const member =
    module && checker.getExportsOfModule(module).find((value) => value.name === key.text)
  return member && (member.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(member) : member)
}

function fulfillmentModule(checker: ts.TypeChecker, parameter: ts.ParameterDeclaration) {
  const fn = parameter.parent
  const call = fn.parent
  if (
    !(
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
      ts.isCallExpression(call) &&
      call.arguments[0] === fn &&
      fn.parameters[0] === parameter &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === 'then'
    )
  )
    return undefined
  const imported = unwrapTransparentExpression(call.expression.expression)
  return ts.isCallExpression(imported) &&
    imported.expression.kind === ts.SyntaxKind.ImportKeyword &&
    imported.arguments[0] &&
    ts.isStringLiteral(imported.arguments[0])
    ? checker.getSymbolAtLocation(imported.arguments[0])
    : undefined
}
