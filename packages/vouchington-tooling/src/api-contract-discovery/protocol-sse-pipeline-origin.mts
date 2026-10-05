import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import { visit } from './response-contract-route-analysis.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'

/** Match the selected factory invocation's concrete returned stream without inventing aliases. */
export function factoryPipeline(
  frame: WriteReceiver,
  invocation: ts.CallExpression,
  fn: ts.FunctionLikeDeclaration,
  stream: WriteReceiver,
  checker: ts.TypeChecker,
): boolean {
  if (frame.mutableAlias) return false
  let declaration = frame.root.valueDeclaration
  let path = frame.path
  if (declaration && ts.isBindingElement(declaration)) {
    if (!ts.isObjectBindingPattern(declaration.parent) || declaration.dotDotDotToken) return false
    const name = declaration.propertyName ?? declaration.name
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return false
    path = [name.text, ...path]
    declaration = declaration.parent.parent
  }
  if (!declaration || !ts.isVariableDeclaration(declaration) || path.length !== 1) return false
  let initializer = declaration.initializer && unwrapExpression(declaration.initializer)
  if (!initializer) {
    const owner = enclosingFunction(declaration)
    if (!owner) return false
    const writes: ts.Expression[] = []
    visit(owner, (node) => {
      for (const target of contextMutationTargets(node))
        if (ts.isIdentifier(target) && checker.getSymbolAtLocation(target) === frame.root)
          writes.push(ts.isBinaryExpression(node) ? node.right : target)
    })
    if (writes.length !== 1) return false
    initializer = unwrapExpression(writes[0]!)
  }
  if (initializer !== invocation) return false
  const returns = returnedExpressions(fn)
  return (
    returns.length > 0 &&
    returns.every((expression) => {
      if (!expression) return false
      const value = unwrapExpression(expression)
      if (!ts.isObjectLiteralExpression(value)) return false
      const properties = value.properties.filter(
        (property) =>
          !ts.isSpreadAssignment(property) &&
          property.name &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
          property.name.text === path[0],
      )
      if (value.properties.some(ts.isSpreadAssignment) || properties.length !== 1) return false
      const property = properties[0]!
      if (ts.isPropertyAssignment(property))
        return sameWriteReceiver(stream, expressionReceiver(property.initializer, checker))
      if (!ts.isShorthandPropertyAssignment(property)) return false
      const symbol = checker.getShorthandAssignmentValueSymbol(property)
      return !!symbol && sameWriteReceiver(stream, { root: symbol, path: [] })
    })
  )
}
