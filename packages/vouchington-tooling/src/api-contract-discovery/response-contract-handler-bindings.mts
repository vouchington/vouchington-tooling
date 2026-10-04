import ts from '../contract-schema/typescript-api.mts'

import { executableProtocolPath } from './protocol-execution-path.mts'
import { attributionSymbol, resolveSymbol } from './response-contract-symbols.mts'
import {
  propertyName,
  routeTemplateFromExpression,
  unwrapTransparentExpression,
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
  const attributionBindingsBySymbol = new Map<ts.Symbol, RouteBinding[]>()
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
      if (ambiguousBindings) {
        for (const symbol of handlerArgumentSymbols(node, checker, true)) {
          const resolvedAttributionSymbol = attributionSymbol(
            resolveHandlerSymbol(symbol, checker),
            checker,
          )
          const attributionCandidates =
            attributionBindingsBySymbol.get(resolvedAttributionSymbol) ?? []
          attributionCandidates.push(binding)
          attributionBindingsBySymbol.set(resolvedAttributionSymbol, attributionCandidates)
        }
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
    }
  }
  if (ambiguousBindings) {
    for (const [symbol, candidates] of attributionBindingsBySymbol) {
      const [first] = candidates
      const unambiguous = candidates.every(
        (candidate) =>
          candidate.method === first!.method && candidate.routeTemplate === first!.routeTemplate,
      )
      if (!unambiguous) {
        ambiguousBindings.set(
          symbol,
          [
            ...new Set(candidates.map(({ method, routeTemplate }) => `${method}:${routeTemplate}`)),
          ].toSorted(),
        )
      }
    }
  }
  return bindings
}

function resolveHandlerSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  const seen = new Set<ts.Symbol>()
  let current = resolveSymbol(symbol, checker)
  while (!seen.has(current)) {
    seen.add(current)
    const declaration = current.valueDeclaration
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
      return current
    if (
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    )
      return current
    const initializer = unwrapTransparentExpression(declaration.initializer)
    if (!ts.isIdentifier(initializer)) return current
    const next = checker.getSymbolAtLocation(initializer)
    if (!next) return current
    current = resolveSymbol(next, checker)
  }
  return current
}

function handlerArgumentSymbols(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  unwrapArguments = false,
): ts.Symbol[] {
  const symbols: ts.Symbol[] = []
  for (const originalArgument of node.arguments) {
    const argument = unwrapArguments
      ? unwrapTransparentExpression(originalArgument)
      : originalArgument
    if (ts.isIdentifier(argument)) {
      const symbol = checker.getSymbolAtLocation(argument)
      if (symbol) symbols.push(symbol)
      continue
    }
    if (unwrapArguments && ts.isPropertyAccessExpression(argument)) {
      const symbol = checker.getSymbolAtLocation(argument.name)
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
