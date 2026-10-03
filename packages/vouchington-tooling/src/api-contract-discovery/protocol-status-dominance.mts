import ts from '../contract-schema/typescript-api.mts'

/** Requires a direct status setter on every lexical path reaching one body emission. */
export function statusDominatesEmission(
  emission: ts.CallExpression,
  statuses: ReadonlySet<ts.CallExpression>,
): boolean {
  let current: ts.Node = emission
  while (current.parent && !ts.isFunctionLike(current.parent)) {
    const parent = current.parent
    if (ts.isBlock(parent)) {
      const index = parent.statements.indexOf(current as ts.Statement)
      if (
        parent.statements
          .slice(0, index)
          .some(
            (statement) =>
              ts.isExpressionStatement(statement) &&
              ts.isCallExpression(statement.expression) &&
              statuses.has(statement.expression),
          )
      )
        return true
    }
    current = parent
  }
  return false
}
