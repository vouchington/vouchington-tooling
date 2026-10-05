import ts from '../contract-schema/typescript-api.mts'

const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

/**
 * True when, within its own function, the node runs only under an `if` or ternary branch, the
 * right side of `&&`, `||` or `??`, a `switch` case, a loop body, a `catch` or a `finally`. Early returns are not modeled.
 */
export function isConditionalPosition(node: ts.Node): boolean {
  let child = node
  for (let parent = node.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent) {
    if (ts.isIfStatement(parent) && child !== parent.expression) return true
    if (ts.isConditionalExpression(parent) && child !== parent.condition) return true
    if (
      ts.isBinaryExpression(parent) &&
      child === parent.right &&
      SHORT_CIRCUIT.has(parent.operatorToken.kind)
    )
      return true
    if (ts.isCaseOrDefaultClause(parent) || ts.isCatchClause(parent)) return true
    if (ts.isIterationStatement(parent, false) && child === parent.statement) return true
    if (ts.isTryStatement(parent) && child === parent.finallyBlock) return true
    child = parent
  }
  return false
}
