import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'

/** Only result operands can forward a capability; dead branches and comma prefixes do not. */
export function contextResultBranches(value: ts.Expression): ts.Expression[] {
  if (ts.isConditionalExpression(value))
    return [value.whenTrue, value.whenFalse].filter(potentiallyExecuted)
  if (!ts.isBinaryExpression(value)) return []
  if (value.operatorToken.kind === ts.SyntaxKind.CommaToken) return [value.right]
  return [
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.AmpersandAmpersandToken,
  ].includes(value.operatorToken.kind)
    ? [value.left, value.right].filter(potentiallyExecuted)
    : []
}
