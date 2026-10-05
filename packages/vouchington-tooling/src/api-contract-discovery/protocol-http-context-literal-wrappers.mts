import { createContextCapture } from './protocol-http-context-capture.mts'
import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
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
  const capture = createContextCapture(checker, roots)
  function record(node: ts.Node) {
    if (isProtocolCallbackFunction(node) && node.body) {
      const seen = new Set<ts.Symbol>()
      function parameters(value: ts.Node) {
        for (const symbol of capture(value)) {
          if (seen.has(symbol)) continue
          seen.add(symbol)
          const declaration = symbol.valueDeclaration
          if (declaration && ts.isParameter(declaration)) returnedParameters.add(symbol)
          else if (
            declaration &&
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer &&
            enclosingFunction(declaration) === node
          )
            parameters(declaration.initializer)
        }
      }
      for (const value of returnedExpressions(node)) if (value) parameters(value)
    }
    let owner: ts.Identifier | undefined
    let expression: ts.Node | undefined
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      owner = node.name
      expression = node
    }
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
    if (ts.isPropertyDeclaration(node) && node.initializer)
      for (const symbol of capture(node.initializer)) stored.add(symbol)
  }
  return { capture, record, stored, parents, returnedParameters }
}
