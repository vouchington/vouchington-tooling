import ts from '../contract-schema/typescript-api.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import {
  createProtocolCallbackValueResolver,
  protocolCallbackSourceCalls,
} from './protocol-callback-values.mts'

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
  if (
    !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) ||
    fn.parameters[0] !== parameter
  )
    return undefined
  const callbacks = createProtocolCallbackValueResolver(checker)
  const calls = ts.isCallExpression(fn.parent) ? [fn.parent] : protocolCallbackSourceCalls(fn)
  for (const call of calls) {
    if (
      !call.arguments[0] ||
      !ts.isPropertyAccessExpression(call.expression) ||
      call.expression.name.text !== 'then' ||
      callbacks.resolve(call.arguments[0], new Map())?.node !== fn
    )
      continue
    const module = importPromiseModule(checker, call.expression.expression)
    if (module) return module
  }
  return undefined
}

/** Promise aliases retain origins only through stable const initializers and literal imports. */
function importPromiseModule(
  checker: ts.TypeChecker,
  value: ts.Expression,
  seen = new Set<ts.Symbol>(),
): ts.Symbol | undefined {
  value = unwrapTransparentExpression(value)
  if (ts.isIdentifier(value)) {
    const binding = checker.getSymbolAtLocation(value)
    if (!binding || seen.has(binding)) return undefined
    const declaration = binding.valueDeclaration
    return declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const
      ? importPromiseModule(checker, declaration.initializer, new Set(seen).add(binding))
      : undefined
  }
  return ts.isCallExpression(value) &&
    value.expression.kind === ts.SyntaxKind.ImportKeyword &&
    value.arguments[0] &&
    ts.isStringLiteral(value.arguments[0])
    ? checker.getSymbolAtLocation(value.arguments[0])
    : undefined
}

/** Only a fulfillment function's own first arguments slot denotes the imported module. */
export function contextImportArgumentsModule(checker: ts.TypeChecker, value: ts.Expression) {
  value = unwrapTransparentExpression(value)
  if (
    !ts.isElementAccessExpression(value) ||
    !ts.isIdentifier(value.expression) ||
    value.expression.text !== 'arguments' ||
    !ts.isNumericLiteral(value.argumentExpression) ||
    value.argumentExpression.text !== '0'
  )
    return undefined
  let owner: ts.Node | undefined = value.parent
  while (owner && !ts.isFunctionLike(owner)) owner = owner.parent
  while (owner && ts.isArrowFunction(owner)) {
    owner = owner.parent
    while (owner && !ts.isFunctionLike(owner)) owner = owner.parent
  }
  return owner && ts.isFunctionExpression(owner) && owner.parameters[0]
    ? fulfillmentModule(checker, owner.parameters[0])
    : undefined
}
