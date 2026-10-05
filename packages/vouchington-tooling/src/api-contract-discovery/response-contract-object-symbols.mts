import ts from '../contract-schema/typescript-api.mts'

import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

export function propertyImplementationSymbol(
  access: ts.PropertyAccessExpression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const contextual = checker.getSymbolAtLocation(access.name)
  const receiver = unwrapTransparentExpression(access.expression)
  if (!contextual || !ts.isIdentifier(receiver)) return undefined
  const receiverSymbol = checker.getSymbolAtLocation(receiver)
  const declaration = receiverSymbol?.valueDeclaration
  if (!declaration || !ts.isVariableDeclaration(declaration)) return contextual
  if (
    !declaration.initializer ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  )
    return undefined
  return constObjectPropertySymbol(receiver, access.name.text, checker)
}
export function destructuredPropertyImplementationSymbol(
  declaration: ts.BindingElement,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const pattern = declaration.parent
  if (!ts.isObjectBindingPattern(pattern) || !ts.isIdentifier(declaration.name)) return undefined
  const variable = pattern.parent
  if (
    !ts.isVariableDeclaration(variable) ||
    !variable.initializer ||
    !ts.isVariableDeclarationList(variable.parent) ||
    !(variable.parent.flags & ts.NodeFlags.Const)
  )
    return undefined
  if (declaration.dotDotDotToken || declaration.initializer) return undefined
  const property = declaration.propertyName ?? declaration.name
  if (!ts.isIdentifier(property) && !ts.isStringLiteral(property)) return undefined
  const initializer = unwrapTransparentExpression(variable.initializer)
  return ts.isIdentifier(initializer)
    ? constObjectPropertySymbol(initializer, property.text, checker)
    : undefined
}
function constObjectPropertySymbol(
  receiver: ts.Identifier,
  key: string,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): ts.Symbol | undefined {
  const receiverSymbol = checker.getSymbolAtLocation(receiver)
  if (!receiverSymbol || seen.has(receiverSymbol)) return undefined
  seen.add(receiverSymbol)
  const declaration = receiverSymbol.valueDeclaration
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  )
    return undefined
  const initializer = unwrapTransparentExpression(declaration.initializer)
  if (ts.isIdentifier(initializer))
    return constObjectPropertySymbol(initializer, key, checker, seen)
  if (!ts.isObjectLiteralExpression(initializer)) return undefined
  if (initializer.properties.some(ts.isSpreadAssignment)) return undefined
  const implementation = initializer.properties.findLast((property) => {
    const name = property.name!
    return objectLiteralPropertyName(name) === key
  })
  if (implementation && ts.isPropertyAssignment(implementation)) {
    const value = unwrapTransparentExpression(implementation.initializer)
    if (ts.isIdentifier(value)) return checker.getSymbolAtLocation(value)
  }
  if (
    implementation &&
    (ts.isGetAccessorDeclaration(implementation) || ts.isSetAccessorDeclaration(implementation))
  )
    return undefined
  return implementation?.name && checker.getSymbolAtLocation(implementation.name)
}

function objectLiteralPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text
  if (!ts.isComputedPropertyName(name)) return undefined
  const expression = unwrapTransparentExpression(name.expression)
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined
}
