import ts from '../contract-schema/typescript-api.mts'

import { executableProtocolPath } from './protocol-execution-path.mts'
import { resolveSymbol } from './response-contract-symbols.mts'
import {
  propertyName,
  routeTemplateFromExpression,
  visit,
} from './response-contract-route-syntax.mts'
import type {
  AmbiguousHandlerBindings,
  HandlerBindings,
  RouteBinding,
} from './response-contract-route-analysis.mts'

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export function collectHandlerBindings(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  ambiguousBindings?: AmbiguousHandlerBindings,
): HandlerBindings {
  const bindingsBySymbol = new Map<ts.Symbol, RouteBinding[]>()
  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return
      const method = propertyName(node.expression)?.toUpperCase()
      if (!method || !HTTP_METHODS.has(method)) return
      const routeTemplate = routeTemplateFromExpression(node.expression)
      if (!routeTemplate) return
      const binding = { method, routeTemplate }
      for (const symbol of handlerArgumentSymbols(node, checker)) {
        const resolved = resolveSymbol(symbol, checker)
        const candidates = bindingsBySymbol.get(resolved) ?? []
        candidates.push(binding)
        bindingsBySymbol.set(resolved, candidates)
      }
    })
  }

  const bindings: HandlerBindings = new Map()
  for (const [symbol, candidates] of bindingsBySymbol) {
    const [first] = candidates
    const unambiguous = candidates.every(
      (candidate) =>
        candidate.method === first!.method && candidate.routeTemplate === first!.routeTemplate,
    )
    if (unambiguous) {
      bindings.set(symbol, first!)
    } else if (ambiguousBindings) {
      ambiguousBindings.set(
        symbol,
        [
          ...new Set(candidates.map(({ method, routeTemplate }) => `${method}:${routeTemplate}`)),
        ].toSorted(),
      )
    }
  }
  return bindings
}

function handlerArgumentSymbols(node: ts.CallExpression, checker: ts.TypeChecker): ts.Symbol[] {
  const symbols: ts.Symbol[] = []
  for (const argument of node.arguments) {
    if (ts.isIdentifier(argument)) {
      const symbol = checker.getSymbolAtLocation(argument)
      if (symbol) symbols.push(symbol)
      continue
    }
    if (!isFunctionLike(argument)) continue
    visitHandlerCalls(argument, argument, checker, (child) => {
      const symbol = checker.getSymbolAtLocation(child.expression)
      if (symbol) symbols.push(symbol)
    })
  }
  return symbols
}

function visitHandlerCalls(
  node: ts.Node,
  root: ts.Node,
  checker: ts.TypeChecker,
  onCall: (node: ts.CallExpression) => void,
): void {
  if (node !== root && isRouteHandlerFunction(node)) return
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    executableProtocolPath(node, checker)
  )
    onCall(node)
  ts.forEachChild(node, (child) => visitHandlerCalls(child, root, checker, onCall))
}

function isRouteHandlerFunction(node: ts.Node): boolean {
  if (!isFunctionLike(node) || !ts.isCallExpression(node.parent)) return false
  const method = propertyName(node.parent.expression)?.toUpperCase()
  return (
    !!method && HTTP_METHODS.has(method) && !!routeTemplateFromExpression(node.parent.expression)
  )
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}
