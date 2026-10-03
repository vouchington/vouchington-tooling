import ts from '../contract-schema/typescript-api.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'

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

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

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
      if (binding) return binding
    }
    current = current.parent
  }
  return undefined
}

export function collectHandlerBindings(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
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
    // A symbol bound to more than one distinct route (a genuinely shared handler function) can't
    // be attributed to either one — recording an arbitrary winner would misdocument whichever
    // route lost.
    if (unambiguous) bindings.set(symbol, first!)
  }
  return bindings
}

/**
 * Symbols a route registration call directly implicates: identifiers passed by reference
 * (`app.route(...).post(handleThing)`), and — for an inline handler argument — every plain named
 * function it calls directly, e.g. `app.route(...).post(async ctx => { await handleThing(ctx) })`.
 * `enclosingRouteBinding`'s lexical walk can't see through the latter case on its own, since
 * `handleThing`'s body isn't lexically nested inside the route registration at all; recording its
 * symbol here lets the same `handlerBindings` lookup resolve it.
 */
function handlerArgumentSymbols(node: ts.CallExpression, checker: ts.TypeChecker): ts.Symbol[] {
  const symbols: ts.Symbol[] = []
  for (const argument of node.arguments) {
    if (ts.isIdentifier(argument)) {
      const symbol = checker.getSymbolAtLocation(argument)
      if (symbol) symbols.push(symbol)
      continue
    }
    if (isFunctionLike(argument)) {
      visit(argument, (child) => {
        if (!ts.isCallExpression(child) || !ts.isIdentifier(child.expression)) return
        const symbol = checker.getSymbolAtLocation(child.expression)
        if (symbol) symbols.push(symbol)
      })
    }
  }
  return symbols
}

function functionSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return checker.getSymbolAtLocation(node.name)
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return checker.getSymbolAtLocation(node.parent.name)
  }
  return undefined
}

function resolveSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

export function routeTemplateFromExpression(expression: ts.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  return findRouteCall(expression.expression)
}

function findRouteCall(expression: ts.Expression): string | undefined {
  if (!ts.isCallExpression(expression)) return undefined
  if (!ts.isPropertyAccessExpression(expression.expression)) return undefined
  if (expression.expression.name.text === 'route') {
    const route = expression.arguments[0]
    return route && ts.isStringLiteral(route) ? route.text : undefined
  }
  return findRouteCall(expression.expression.expression)
}

export function propertyName(expression: ts.Expression): string | undefined {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

export function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node)
  node.forEachChild((child) => visit(child, callback))
}
