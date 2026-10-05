import ts from '../contract-schema/typescript-api.mts'
import { functionSymbol, resolveSymbol } from './response-contract-symbols.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import {
  HTTP_METHODS,
  propertyName,
  routeTemplateFromExpression,
} from './response-contract-route-syntax.mts'

export { collectHandlerBindings } from './response-contract-handler-bindings.mts'
export {
  propertyName,
  routeTemplateFromExpression,
  visit,
} from './response-contract-route-syntax.mts'

export {
  isContextMethod,
  isContextResponseBufferCall,
  isContextResponseEmptyCall,
  responseMarker,
} from './response-contract-ctx-analysis.mts'

export type RouteBinding = {
  method: string
  routeTemplate: string
}

export type HandlerBindings = Map<ts.Symbol, RouteBinding>
export type AmbiguousHandlerBindings = Map<ts.Symbol, readonly string[]>

export function requestedKeyForBinding(
  binding: RouteBinding,
  requestedKeys?: ReadonlySet<string>,
): string | undefined {
  if (!requestedKeys) return `${binding.method}:${binding.routeTemplate}`
  const exact = `${binding.method}:${binding.routeTemplate}`
  if (requestedKeys.has(exact)) return exact
  const bindingShape = routeShape(binding.routeTemplate)
  return [...requestedKeys]
    .filter((key) => !key.includes('#'))
    .find((key) => {
      const separator = key.indexOf(':')
      return (
        key.slice(0, separator) === binding.method &&
        routeShape(key.slice(separator + 1)) === bindingShape
      )
    })
}

function routeShape(routeTemplate: string): string {
  return routeTemplate.replace(/:[^/]+/g, ':')
}

export function enclosingRouteBinding(
  node: ts.Node,
  checker: ts.TypeChecker,
  handlerBindings: HandlerBindings,
  proveCallbacks = true,
): RouteBinding | undefined {
  let current: ts.Node | undefined = node
  let insideHandlerFunction = false
  while (current) {
    if (ts.isFunctionLike(current)) insideHandlerFunction = true
    if (insideHandlerFunction && ts.isCallExpression(current)) {
      const method = propertyName(current.expression)?.toUpperCase()
      const routeTemplate = routeTemplateFromExpression(current.expression)
      if (method && HTTP_METHODS.has(method) && routeTemplate)
        return !proveCallbacks || executableProtocolPath(node, checker)
          ? { method, routeTemplate }
          : undefined
    }
    if (isFunctionLike(current) && ts.isCallExpression(current.parent)) {
      const handlerCall = current.parent
      const method = propertyName(handlerCall.expression)?.toUpperCase()
      if (method && HTTP_METHODS.has(method)) {
        const routeTemplate = routeTemplateFromExpression(handlerCall.expression)
        if (routeTemplate)
          return !proveCallbacks || executableProtocolPath(node, checker)
            ? { method, routeTemplate }
            : undefined
      }
    }
    const handlerSymbol = functionSymbol(current, checker)
    if (handlerSymbol) {
      const binding = handlerBindings.get(resolveSymbol(handlerSymbol, checker))
      if (binding)
        return !proveCallbacks || executableProtocolPath(node, checker, current)
          ? binding
          : undefined
    }
    current = current.parent
  }
  return undefined
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}
