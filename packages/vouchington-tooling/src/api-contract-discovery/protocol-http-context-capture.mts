import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import type { createContextValueRoots } from './protocol-http-context-value-roots.mts'

/** Literal captures are memoized only within their source index. */
export function createContextCapture(
  checker: ts.TypeChecker,
  roots: ReturnType<typeof createContextValueRoots>,
) {
  const captures = new Map<ts.Node, ReadonlySet<ts.Symbol>>()
  function capture(expression: ts.Node): ReadonlySet<ts.Symbol> {
    const hit = captures.get(expression)
    if (hit) return hit
    const result = new Set<ts.Symbol>()
    function returned(fn: ts.FunctionLikeDeclaration) {
      for (const value of returnedExpressions(fn)) if (value) visit(value)
      function yielded(node: ts.Node): void {
        if (isProtocolCallbackFunction(node) && node !== fn) return
        if (ts.isYieldExpression(node) && node.expression && potentiallyExecuted(node))
          visit(node.expression)
        node.forEachChild(yielded)
      }
      if (fn.asteriskToken && fn.body) yielded(fn.body)
    }
    function visit(node: ts.Node) {
      if (ts.isExpression(node)) node = unwrapExpression(node)
      if (ts.isExpression(node) && roots.primitiveValue(node)) return
      if (ts.isConditionalExpression(node)) {
        for (const branch of [node.whenTrue, node.whenFalse])
          if (potentiallyExecuted(branch)) visit(branch)
      } else if (
        ts.isBinaryExpression(node) &&
        [
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.CommaToken,
        ].includes(node.operatorToken.kind)
      ) {
        if (node.operatorToken.kind !== ts.SyntaxKind.CommaToken) visit(node.left)
        if (potentiallyExecuted(node.right)) visit(node.right)
      } else if (ts.isSpreadElement(node)) visit(node.expression)
      else if (ts.isObjectLiteralExpression(node)) {
        for (const member of node.properties) {
          if (ts.isPropertyAssignment(member)) visit(member.initializer)
          if (ts.isSpreadAssignment(member)) visit(member.expression)
          if (isProtocolCallbackFunction(member) && member.body) returned(member)
          if (ts.isShorthandPropertyAssignment(member)) {
            const target = checker.getShorthandAssignmentValueSymbol(member)
            const declaration = target?.valueDeclaration
            const name =
              declaration &&
              (ts.isVariableDeclaration(declaration) || ts.isBindingElement(declaration))
                ? declaration.name
                : undefined
            const symbol = name && ts.isIdentifier(name) ? roots.root(name) : target
            if (symbol) result.add(symbol)
          }
        }
      } else if (isProtocolCallbackFunction(node) && node.body) {
        returned(node)
      } else if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements)
          if (!ts.isOmittedExpression(element))
            visit(ts.isSpreadElement(element) ? element.expression : element)
      } else if (ts.isExpression(node)) {
        const symbol = roots.root(node)
        if (symbol) result.add(symbol)
      }
    }
    visit(expression)
    captures.set(expression, result)
    return result
  }
  return capture
}

/** Descendant function locals belong to their enclosing factory, preserving capture provenance. */
export function contextFunctionOwns(declaration: ts.Node, owner: ts.Node): boolean {
  for (let scope = enclosingFunction(declaration); scope; scope = enclosingFunction(scope))
    if (scope === owner) return true
  return false
}
