import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

/** Literal containers pass their values to a consumer even without a receiver of their own. */
export function someSseArgumentValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  matches: (expression: ts.Expression) => boolean,
): boolean {
  const value = unwrapExpression(expression)
  if (ts.isSpreadElement(value)) return someSseArgumentValue(value.expression, checker, matches)
  if (ts.isArrayLiteralExpression(value))
    return value.elements.some(
      (element) =>
        !ts.isOmittedExpression(element) && someSseArgumentValue(element, checker, matches),
    )
  if (ts.isObjectLiteralExpression(value))
    return value.properties.some((property) => {
      if (ts.isPropertyAssignment(property))
        return someSseArgumentValue(property.initializer, checker, matches)
      if (ts.isSpreadAssignment(property))
        return someSseArgumentValue(property.expression, checker, matches)
      if (!ts.isShorthandPropertyAssignment(property)) return false
      const declaration = checker.getShorthandAssignmentValueSymbol(property)?.valueDeclaration
      return !!(
        declaration &&
        (ts.isVariableDeclaration(declaration) ||
          ts.isParameter(declaration) ||
          ts.isBindingElement(declaration)) &&
        ts.isIdentifier(declaration.name) &&
        someSseArgumentValue(declaration.name, checker, matches)
      )
    })
  return matches(value)
}
