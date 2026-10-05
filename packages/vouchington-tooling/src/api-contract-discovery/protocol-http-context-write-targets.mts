import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

/** Loop initializers can overwrite existing bindings just like assignment expressions. */
export function contextMutationTargets(node: ts.Node): ts.Expression[] {
  let write: ts.Expression | undefined
  if (ts.isDeleteExpression(node)) write = node.expression
  else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  )
    write = node.left
  else if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  )
    write = node.operand
  else if (
    (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
    ts.isExpression(node.initializer)
  )
    write = node.initializer
  return write ? contextWriteTargets(write) : []
}

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
