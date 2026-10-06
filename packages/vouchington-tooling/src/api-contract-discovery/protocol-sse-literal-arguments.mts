import ts from '../contract-schema/typescript-api.mts'
import { selectedSseCallableCapture } from './protocol-sse-wrapper-captures.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { methodAccess } from './protocol-http-method-access.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

/** Literal containers pass their values to a consumer even without a receiver of their own. */
export function someSseArgumentValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  matches: (expression: ts.Expression) => boolean,
  followLiteralAliases = false,
): boolean {
  const active = new Set<ts.Node>()
  function contains(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression)
    if (active.has(value)) return true
    active.add(value)
    try {
      if (followLiteralAliases && ts.isIdentifier(value)) {
        const resolved = createProtocolCallbackValueResolver(checker).resolve(
          value,
          new Map(),
        )?.node
        if (
          resolved &&
          (ts.isObjectLiteralExpression(resolved) || ts.isArrayLiteralExpression(resolved))
        )
          return contains(resolved)
      }
      const access = methodAccess(value)
      const member =
        access &&
        checker.getPropertyOfType(checker.getTypeAtLocation(access.receiver), access.name)
          ?.valueDeclaration
      if (member && ts.isGetAccessorDeclaration(member))
        return selectedSseCallableCapture(member, matches)
      if (ts.isSpreadElement(value)) return contains(value.expression)
      if (ts.isArrayLiteralExpression(value))
        return value.elements.some(
          (element) => !ts.isOmittedExpression(element) && contains(element),
        )
      if (ts.isObjectLiteralExpression(value))
        return value.properties.some((property) => {
          if (ts.isPropertyAssignment(property)) return contains(property.initializer)
          if (
            ts.isMethodDeclaration(property) ||
            ts.isGetAccessorDeclaration(property) ||
            ts.isSetAccessorDeclaration(property)
          )
            return selectedSseCallableCapture(property, matches)
          if (ts.isSpreadAssignment(property)) return contains(property.expression)
          const declaration = checker.getShorthandAssignmentValueSymbol(property)?.valueDeclaration
          return !!(
            declaration &&
            (ts.isVariableDeclaration(declaration) ||
              ts.isParameter(declaration) ||
              ts.isBindingElement(declaration)) &&
            ts.isIdentifier(declaration.name) &&
            contains(declaration.name)
          )
        })
      return matches(value)
    } finally {
      active.delete(value)
    }
  }
  return contains(expression)
}
