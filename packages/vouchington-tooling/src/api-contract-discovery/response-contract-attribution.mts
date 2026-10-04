import ts from '../contract-schema/typescript-api.mts'

import { functionSymbol, resolveSymbol } from './response-contract-symbols.mts'
import {
  propertyName,
  routeTemplateFromExpression,
  type HandlerBindings,
  type AmbiguousHandlerBindings,
} from './response-contract-route-analysis.mts'

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export function ambiguousRoutesForCall(
  node: ts.Node,
  checker: ts.TypeChecker,
  handlerBindings: HandlerBindings,
  ambiguousBindings: AmbiguousHandlerBindings,
): readonly string[] | undefined {
  let current: ts.Node | undefined = node
  while (current) {
    if (isLexicalRoute(current)) return undefined
    const symbol = functionSymbol(current, checker)
    if (symbol) {
      const resolved = resolveSymbol(symbol, checker)
      if (handlerBindings.has(resolved)) return undefined
      const routes = ambiguousBindings.get(resolved)
      if (routes) return routes
    }
    current = current.parent
  }
  return undefined
}

function isLexicalRoute(node: ts.Node): boolean {
  if (
    (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) ||
    !ts.isCallExpression(node.parent)
  )
    return false
  const method = propertyName(node.parent.expression)?.toUpperCase()
  return (
    !!method && HTTP_METHODS.has(method) && !!routeTemplateFromExpression(node.parent.expression)
  )
}
