import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

/** Destructuring assignment keys are not write targets; their selected values are. */
export function contextWriteTargets(write: ts.Expression): ts.Expression[] {
  const result: ts.Expression[] = []
  function targets(expression: ts.Expression) {
    expression = unwrapExpression(expression)
    if (ts.isObjectLiteralExpression(expression)) {
      for (const member of expression.properties)
        if (ts.isPropertyAssignment(member)) targets(member.initializer)
        else if (ts.isShorthandPropertyAssignment(member)) targets(member.name)
        else if (ts.isSpreadAssignment(member)) targets(member.expression)
    } else if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements)
        if (!ts.isOmittedExpression(element))
          targets(ts.isSpreadElement(element) ? element.expression : element)
    } else if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      targets(expression.left)
    else result.push(expression)
  }
  targets(write)
  return result
}
