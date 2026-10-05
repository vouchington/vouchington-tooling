import ts from '../contract-schema/typescript-api.mts'
import type { Followable } from './request-validation-follow.mts'

const owningFunction = (node: ts.Node) => {
  let current = node.parent
  while (current && !ts.isFunctionLike(current)) current = current.parent
  return current
}

function writtenSymbol(left: ts.Expression, checker: ts.TypeChecker) {
  let current = left
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    current = current.expression
  return ts.isIdentifier(current) ? checker.getSymbolAtLocation(current) : undefined
}

/** Right-hand sides of earlier assignments to the symbol or one of its properties. */
export function priorWrites(
  use: ts.Node,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Expression[] {
  const owner = owningFunction(use)
  const before = use.getStart()
  const writes: ts.Expression[] = []
  const scan = (node: ts.Node): void => {
    if (node.getStart() >= before || (node !== owner && ts.isFunctionLike(node))) return
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      writtenSymbol(node.left, checker) === symbol
    )
      writes.push(node.right)
    ts.forEachChild(node, scan)
  }
  scan(owner ?? use.getSourceFile())
  return writes
}

/** Returned expressions of a function, including an arrow function's expression body. */
export function returnedValues(fn: Followable): ts.Node[] {
  const body = fn.body!
  if (!ts.isBlock(body)) return [body]
  const values: ts.Node[] = []
  const scan = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression) values.push(node.expression)
    ts.forEachChild(node, scan)
  }
  ts.forEachChild(body, scan)
  return values
}
