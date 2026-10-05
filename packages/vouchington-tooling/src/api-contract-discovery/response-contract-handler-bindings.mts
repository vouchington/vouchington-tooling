import ts from '../contract-schema/typescript-api.mts'

import { executableProtocolPath } from './protocol-execution-path.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { attributionSymbol, resolveSymbol } from './response-contract-symbols.mts'
import {
  findMutatedBindings,
  findMutatedProperties,
} from './response-contract-property-mutations.mts'
import {
  handlerArgumentSymbols,
  isMutatedPropertyAccess,
} from './response-contract-handler-calls.mts'
import {
  HTTP_METHODS,
  propertyName,
  routeTemplateFromExpression,
  unwrapTransparentExpression,
  visit,
} from './response-contract-route-syntax.mts'
import {
  destructuredPropertyImplementationSymbol,
  propertyImplementationSymbol,
} from './response-contract-object-symbols.mts'
import type {
  AmbiguousHandlerBindings,
  HandlerBindings,
  RouteBinding,
} from './response-contract-route-analysis.mts'

export function collectHandlerBindings(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  ambiguousBindings?: AmbiguousHandlerBindings,
): HandlerBindings {
  const bindingsBySymbol = new Map<ts.Symbol, RouteBinding[]>()
  const attributionBindingsBySymbol = new Map<ts.Symbol, RouteBinding[]>()
  const mutatedProperties = ambiguousBindings
    ? findMutatedProperties(sourceFiles, checker)
    : undefined
  const mutatedBindings = ambiguousBindings ? findMutatedBindings(sourceFiles, checker) : undefined
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
        if (!potentiallyExecuted(node)) return
        if (!isExportedRouteBuilder(node) && !executableProtocolPath(node, checker)) return
        for (const symbol of handlerArgumentSymbols(node, checker, true, mutatedProperties)) {
          const propertySymbol = attributionSymbol(resolveSymbol(symbol, checker), checker)
          if (mutatedProperties?.has(propertySymbol)) continue
          const handlerSymbol = resolveHandlerSymbol(symbol, checker, mutatedProperties)
          const resolvedAttributionSymbol = attributionSymbol(handlerSymbol, checker)
          if (mutatedProperties?.has(resolvedAttributionSymbol)) continue
          if (mutatedBindings?.has(resolvedAttributionSymbol)) continue
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

function isExportedRouteBuilder(node: ts.Node): boolean {
  let current = node.parent
  while (current) {
    if (ts.isFunctionLike(current))
      return (
        ts.isFunctionDeclaration(current) &&
        !!(
          ts.getCombinedModifierFlags(current) &
          (ts.ModifierFlags.Export | ts.ModifierFlags.Default)
        )
      )
    current = current.parent
  }
  return false
}

function resolveHandlerSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  mutatedProperties?: ReadonlySet<ts.Symbol>,
): ts.Symbol {
  const seen = new Set<ts.Symbol>()
  let current = resolveSymbol(symbol, checker)
  while (!seen.has(current)) {
    seen.add(current)
    const declaration = current.valueDeclaration
    if (declaration && ts.isBindingElement(declaration)) {
      const value = destructuredPropertyImplementationSymbol(declaration, checker)
      if (!value) return current
      current = resolveSymbol(value, checker)
      continue
    }
    if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
      const value = checker.getShorthandAssignmentValueSymbol(declaration)
      if (!value) return current
      current = resolveSymbol(value, checker)
      continue
    }
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
      return current
    if (
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const)
    )
      return current
    const initializer = unwrapTransparentExpression(declaration.initializer)
    if (
      ts.isPropertyAccessExpression(initializer) &&
      isMutatedPropertyAccess(initializer, checker, mutatedProperties)
    )
      return current
    const next = ts.isIdentifier(initializer)
      ? checker.getSymbolAtLocation(initializer)
      : ts.isPropertyAccessExpression(initializer)
        ? propertyImplementationSymbol(initializer, checker)
        : undefined
    if (!next) return current
    current = resolveSymbol(next, checker)
  }
  return current
}
