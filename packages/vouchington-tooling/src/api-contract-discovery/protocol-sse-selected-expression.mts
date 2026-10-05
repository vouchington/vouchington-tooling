import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

/** Unsupported receiver alternatives retain the selected capability and fail closed. */
export function selectedSseExpression(
  expression: ts.Expression,
  selected: (value: ts.Expression) => boolean,
): boolean {
  const value = unwrapExpression(expression)
  if (selected(value)) return true
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))
    return selectedSseExpression(value.expression, selected)
  if (ts.isConditionalExpression(value))
    return (
      selectedSseExpression(value.whenTrue, selected) ||
      selectedSseExpression(value.whenFalse, selected)
    )
  return (
    ts.isBinaryExpression(value) &&
    [
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
    ].includes(value.operatorToken.kind) &&
    (selectedSseExpression(value.left, selected) || selectedSseExpression(value.right, selected))
  )
}
