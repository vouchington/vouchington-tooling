import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

/** Excludes statically dead branches without claiming that dynamic branches always run. */
export function potentiallyExecuted(node: ts.Node): boolean {
  let current = node
  while (current.parent && !ts.isFunctionLike(current.parent)) {
    const parent = current.parent
    if (ts.isBlock(parent)) {
      const index = parent.statements.indexOf(current as ts.Statement)
      if (parent.statements.slice(0, index).some(terminates)) return false
    }
    if (ts.isIfStatement(parent)) {
      const condition = unwrapExpression(parent.expression).kind
      if (condition === ts.SyntaxKind.FalseKeyword && parent.thenStatement === current) return false
      if (condition === ts.SyntaxKind.TrueKeyword && parent.elseStatement === current) return false
    }
    if (
      (ts.isWhileStatement(parent) || ts.isForStatement(parent)) &&
      parent.statement === current
    ) {
      const condition = ts.isWhileStatement(parent) ? parent.expression : parent.condition
      if (condition && unwrapExpression(condition).kind === ts.SyntaxKind.FalseKeyword) return false
    }
    if (ts.isConditionalExpression(parent)) {
      const condition = unwrapExpression(parent.condition).kind
      if (condition === ts.SyntaxKind.FalseKeyword && parent.whenTrue === current) return false
      if (condition === ts.SyntaxKind.TrueKeyword && parent.whenFalse === current) return false
    }
    if (ts.isBinaryExpression(parent) && parent.right === current) {
      const left = unwrapExpression(parent.left).kind
      if (
        left === ts.SyntaxKind.FalseKeyword &&
        parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      )
        return false
      if (
        left === ts.SyntaxKind.TrueKeyword &&
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
      )
        return false
    }
    current = parent
  }
  return true
}

function terminates(statement: ts.Statement): boolean {
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  )
    return true
  if (ts.isBlock(statement)) return statement.statements.some(terminates)
  if (!ts.isIfStatement(statement)) return false
  const condition = unwrapExpression(statement.expression).kind
  if (condition === ts.SyntaxKind.TrueKeyword) return terminates(statement.thenStatement)
  if (condition === ts.SyntaxKind.FalseKeyword)
    return !!statement.elseStatement && terminates(statement.elseStatement)
  return (
    !!statement.elseStatement &&
    terminates(statement.thenStatement) &&
    terminates(statement.elseStatement)
  )
}
