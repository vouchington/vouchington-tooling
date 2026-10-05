import ts from '../contract-schema/typescript-api.mts'
import {
  followedImplementations,
  type Followable,
  type Scope,
} from './request-validation-follow.mts'
import { priorWrites, returnedValues } from './request-validation-trace-helpers.mts'
import { identifierSymbol, resolveKey } from './request-validation-keys.mts'
import { isBodyRead, isHeaderGet, rootKind, type Bound } from './request-validation-origin.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import type { Carrier } from './request-validation-types.mts'

/** The request carriers a value derives from, and why part of it could not be traced. */
export type Trace = { origins: Set<Carrier>; unresolved?: string | undefined }

type Visit = { trace: Trace; symbols: Set<ts.Symbol>; functions: Set<ts.Node> }

/** Binds a followed function's parameters to what the call passes, with their origins. */
export function bindArguments(fn: Followable, call: ts.CallExpression, scope: Scope): Scope {
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
    }
    roots.set(symbol, bound)
  })
  return { ...scope, keys, roots }
}

function visitIdentifier(identifier: ts.Identifier, scope: Scope, visit: Visit) {
  const { trace, symbols } = visit
  const symbol = identifierSymbol(identifier, scope.checker)
  if (!symbol || symbols.has(symbol)) return
  symbols.add(symbol)
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
  }
  for (const write of priorWrites(identifier, symbol, scope.checker))
    visitValue(write, scope, visit)
}

function visitCall(call: ts.CallExpression, scope: Scope, visit: Visit) {
  for (const fn of followedImplementations(call, scope)) {
    if (visit.functions.has(fn)) continue
    const next = {
      ...visit,
      symbols: new Set<ts.Symbol>(),
      functions: new Set(visit.functions).add(fn),
    }
    const bound = bindArguments(fn, call, scope)
    for (const value of returnedValues(fn)) visitValue(value, bound, next)
  }
  ts.forEachChild(call, (child) => visitValue(child, scope, visit))
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
  visitValue(node, scope, { trace, symbols: new Set(), functions: new Set() })
  return trace
}
