import ts from '../contract-schema/typescript-api.mts'

import { executableProtocolPath } from './protocol-execution-path.mts'
import { attributionFunctionSymbol, attributionSymbol } from './response-contract-symbols.mts'
import { isInlineRouteHandler } from './response-contract-route-syntax.mts'
import {
  type HandlerBindings,
  type AmbiguousHandlerBindings,
} from './response-contract-route-analysis.mts'

export function ambiguousRoutesForCall(
  node: ts.Node,
  checker: ts.TypeChecker,
  handlerBindings: HandlerBindings,
  ambiguousBindings: AmbiguousHandlerBindings,
): readonly string[] | undefined {
  let current: ts.Node | undefined = node
  while (current) {
    if (isInlineRouteHandler(current)) return undefined
    const symbol = attributionFunctionSymbol(current, checker)
    if (symbol) {
      const resolved = attributionSymbol(symbol, checker)
      const routes = ambiguousBindings.get(resolved)
      if (routes) return executableProtocolPath(node, checker, current) ? routes : undefined
      if (handlerBindings.has(resolved)) return undefined
    }
    current = current.parent
  }
  return undefined
}
