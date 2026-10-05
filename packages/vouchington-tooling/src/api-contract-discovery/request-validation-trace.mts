import ts from '../contract-schema/typescript-api.mts'
import { followedImplementations, type Scope } from './request-validation-follow.mts'
import { reachingWrites, returnedValues } from './request-validation-trace-helpers.mts'
import { identifierSymbol, resolveKey } from './request-validation-keys.mts'
import { isBodyRead, isHeaderGet, rootKind, type Bound } from './request-validation-origin.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import type { Carrier } from './request-validation-types.mts'

/** The request carriers a value derives from, and why part of it could not be traced. */
export type Trace = { origins: Set<Carrier>; unresolved?: string | undefined }

type Visit = { trace: Trace; seen: Set<ts.Node>; functions: Set<ts.Node> }

/** Binds a followed function's parameters to what the call passes, with their origins. */
export function bindArguments(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression,
  scope: Scope,
): Scope {
  const keys = new Map(scope.keys)
  const roots = new Map(scope.roots)
  runtimeParameters(fn).forEach((parameter, index) => {
    const symbol = ts.isIdentifier(parameter.name)
      ? scope.checker.getSymbolAtLocation(parameter.name)
      : undefined
    if (!symbol) return
    keys.delete(symbol)
    roots.delete(symbol)
    const argument = call.arguments[index]
    if (!argument) return
    const key = resolveKey(argument, scope.checker, scope.keys)
    if (key !== undefined) keys.set(symbol, key)
    const traced = traceValue(argument, scope)
    const bound: Bound = {
      kind: rootKind(argument, scope.roots, scope.checker),
      origins: [...traced.origins],
      unresolved: traced.unresolved,
      expression: argument,
    }
    roots.set(symbol, bound)
  })
  return { ...scope, keys, roots }
}

function visitIdentifier(identifier: ts.Identifier, scope: Scope, visit: Visit) {
  const { seen } = visit
  const symbol = identifierSymbol(identifier, scope.checker)
  if (!symbol || seen.has(identifier)) return
  seen.add(identifier)
  const { writes, initializer } = reachingWrites(identifier, symbol, scope.checker)
  if (initializer) visitDeclared(identifier, symbol, scope, visit)
  for (const write of writes) visitValue(write, scope, visit)
}

/** The value a binding starts with: a call-site binding, a parameter, or its initializer. */
function visitDeclared(identifier: ts.Identifier, symbol: ts.Symbol, scope: Scope, visit: Visit) {
  const { trace } = visit
  const bound = scope.roots.get(symbol)
  if (bound) {
    bound.origins.forEach((origin) => trace.origins.add(origin))
    trace.unresolved ??= bound.unresolved
    return
  }
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isParameter(declaration)) {
      if (!scope.keys.has(symbol))
        trace.unresolved ??= `parameter \`${identifier.text}\` has no call-site binding`
      continue
    }
    const owner = ts.isBindingElement(declaration) ? declaration.parent.parent : declaration
    if (ts.isVariableDeclaration(owner) && owner.initializer)
      visitValue(owner.initializer, scope, visit)
    // `for (const [key, value] of Object.entries(x))` derives from the iterated expression.
    else if (ts.isVariableDeclaration(owner) && ts.isForOfStatement(owner.parent.parent))
      visitValue(owner.parent.parent.expression, scope, visit)
  }
}

function visitCall(call: ts.CallExpression, scope: Scope, visit: Visit) {
  const followed = followedImplementations(call, scope)
  for (const fn of followed) {
    if (visit.functions.has(fn)) continue
    const next = {
      ...visit,
      seen: new Set<ts.Node>(),
      functions: new Set(visit.functions).add(fn),
    }
    const bound = bindArguments(fn, call, scope)
    for (const value of returnedValues(fn)) visitValue(value, bound, next)
  }
  // An opaque call may use any argument; a followed helper's return values already say which.
  if (followed.length === 0) ts.forEachChild(call, (child) => visitValue(child, scope, visit))
}

function visitValue(node: ts.Node, scope: Scope, visit: Visit): void {
  const { checker, roots } = scope
  const { trace } = visit
  if (ts.isFunctionLike(node)) return
  const kind = ts.isExpression(node) ? rootKind(node, roots, checker) : undefined
  if (kind === 'query' || kind === 'path' || kind === 'header') trace.origins.add(kind)
  else if (ts.isCallExpression(node) && isBodyRead(node, roots, checker)) trace.origins.add('body')
  else if (ts.isCallExpression(node) && isHeaderGet(node, roots, checker))
    trace.origins.add('header')
  else if (ts.isCallExpression(node)) visitCall(node, scope, visit)
  else if (ts.isConditionalExpression(node)) {
    visitValue(node.whenTrue, scope, visit)
    visitValue(node.whenFalse, scope, visit)
  } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    visitValue(node.expression, scope, visit)
  else if (ts.isPropertyAssignment(node)) visitValue(node.initializer, scope, visit)
  else if (ts.isIdentifier(node)) visitIdentifier(node, scope, visit)
  else ts.forEachChild(node, (child) => visitValue(child, scope, visit))
}

/** Unions the request origins found anywhere in a value expression. */
export function traceValue(node: ts.Node, scope: Scope): Trace {
  const trace: Trace = { origins: new Set() }
  visitValue(node, scope, { trace, seen: new Set(), functions: new Set() })
  return trace
}
