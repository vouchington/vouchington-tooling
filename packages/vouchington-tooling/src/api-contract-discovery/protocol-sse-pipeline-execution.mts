import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'

/** Account a factory pipeline only when its path cannot bypass it and return a stream. */
export function unconditionalSsePipeline(call: ts.CallExpression, fn: ts.Node): boolean {
  const labels = new Set<string>()
  for (let parent = call.parent; parent && parent !== fn; parent = parent.parent)
    if (ts.isLabeledStatement(parent)) labels.add(parent.label.text)
  let current: ts.Node = call
  while (current.parent && current.parent !== fn) {
    const parent = current.parent
    if (
      ts.isIfStatement(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isIterationStatement(parent, false) ||
      ts.isSwitchStatement(parent) ||
      ts.isTryStatement(parent) ||
      ts.isFunctionLike(parent) ||
      ('questionDotToken' in parent && parent.questionDotToken)
    )
      return false
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === current &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(parent.operatorToken.kind)
    )
      return false
    if (ts.isBlock(parent)) {
      const index = parent.statements.indexOf(current as ts.Statement)
      if (
        parent.statements
          .slice(0, index)
          .some((statement) => exitsBeforePipeline(statement, labels))
      )
        return false
    }
    current = parent
  }
  return current.parent === fn
}

function exitsBeforePipeline(node: ts.Node, labels: ReadonlySet<string>): boolean {
  if (ts.isFunctionLike(node) || !potentiallyExecuted(node)) return false
  if (ts.isReturnStatement(node)) return true
  if (ts.isBreakStatement(node) && node.label && labels.has(node.label.text)) return true
  return (
    ts.forEachChild(node, (child) => (exitsBeforePipeline(child, labels) ? true : undefined)) ??
    false
  )
}
