import ts from '../contract-schema/typescript-api.mts'

/** Requires the last potentially preceding proven status setter to belong to this response. */
export function statusDominatesEmission(
  emission: ts.CallExpression | ts.NewExpression,
  statuses: ReadonlySet<ts.CallExpression>,
  allStatuses: ReadonlySet<ts.CallExpression> = statuses,
): boolean {
  let current: ts.Node = emission
  while (current.parent && !ts.isFunctionLike(current.parent)) {
    const parent = current.parent
    if (ts.isBlock(parent)) {
      const index = parent.statements.indexOf(current as ts.Statement)
      for (const statement of parent.statements.slice(0, index).toReversed())
        if (containsStatus(statement, allStatuses))
          return (
            ts.isExpressionStatement(statement) &&
            ts.isCallExpression(statement.expression) &&
            statuses.has(statement.expression)
          )
    }
    current = parent
  }
  return false
}

function containsStatus(node: ts.Node, statuses: ReadonlySet<ts.CallExpression>): boolean {
  return (
    (ts.isCallExpression(node) && statuses.has(node)) ||
    (ts.forEachChild(node, (child) => containsStatus(child, statuses)) ?? false)
  )
}
