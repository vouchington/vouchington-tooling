import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import type { createContextValueRoots } from './protocol-http-context-value-roots.mts'

/** Literal containment and direct aliases are indexed within this source proof only. */
export function createLiteralWrapperIndex(
  checker: ts.TypeChecker,
  roots: ReturnType<typeof createContextValueRoots>,
) {
  const parents = new Map<ts.Symbol, Set<ts.Symbol>>()
  const stored = new Set<ts.Symbol>()
  const returnedParameters = new Set<ts.Symbol>()
  const captures = new Map<ts.Node, ReadonlySet<ts.Symbol>>()
  function capture(expression: ts.Node): ReadonlySet<ts.Symbol> {
    const hit = captures.get(expression)
    if (hit) return hit
    const result = new Set<ts.Symbol>()
    function returned(fn: ts.FunctionLikeDeclaration) {
      for (const value of returnedExpressions(fn)) if (value) visit(value)
    }
    function visit(node: ts.Node) {
      if (ts.isExpression(node)) node = unwrapExpression(node)
      if (ts.isExpression(node) && roots.primitiveValue(node)) return
      if (ts.isObjectLiteralExpression(node)) {
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
  function record(node: ts.Node) {
    if (isProtocolCallbackFunction(node) && node.body)
      for (const value of returnedExpressions(node))
        if (value)
          for (const symbol of capture(value))
            if (symbol.valueDeclaration && ts.isParameter(symbol.valueDeclaration))
              returnedParameters.add(symbol)
    let owner: ts.Identifier | undefined
    let expression: ts.Expression | undefined
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      owner = node.name
      expression = node.initializer
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
      const declaration = node.parent.parent
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        owner = node.name
        expression = declaration.initializer
      }
    }
    if (owner && expression && !roots.primitiveValue(owner)) {
      const symbol = checker.getSymbolAtLocation(owner)
      if (symbol)
        for (const child of capture(expression)) {
          if (child === symbol) continue
          const containers = parents.get(child) ?? new Set<ts.Symbol>()
          containers.add(symbol)
          parents.set(child, containers)
        }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      for (const symbol of capture(node.right)) stored.add(symbol)
  }
  return { capture, record, stored, parents, returnedParameters }
}
