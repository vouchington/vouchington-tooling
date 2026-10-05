import ts from '../contract-schema/typescript-api.mts'
import { followedImplementations, type Scope } from './request-validation-follow.mts'
import { bindingKey, literalMember } from './request-validation-select.mts'
import { returnedValues } from './request-validation-trace-helpers.mts'
import type { Carrier } from './request-validation-types.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

/** The request carriers a value derives from, and why part of it could not be traced. */
export type Trace = { origins: Set<Carrier>; unresolved?: string | undefined }

export type Visit = {
  trace: Trace
  seen: Set<ts.Node>
  functions: Set<ts.Node>
  /** Calls whose arguments are being traced, so a value that feeds its own call terminates. */
  calls: Set<ts.Node>
}

/** The tracer's own entry points, passed in so this module does not import it back. */
type Deps = {
  visitValue: (node: ts.Node, scope: Scope, visit: Visit) => void
  bindArguments: (
    fn: ts.FunctionLikeDeclaration,
    call: ts.CallExpression,
    scope: Scope,
    calls: Set<ts.Node>,
  ) => Scope
}

/** Traces only what a destructured local binds; false when the selection cannot be resolved. */
export function visitSelected(
  element: ts.BindingElement,
  initializer: ts.Expression,
  scope: Scope,
  visit: Visit,
  deps: Deps,
): boolean {
  const key = bindingKey(element)
  const selected: Visit = { ...visit, trace: { origins: new Set() } }
  if (key === undefined || !visitMember(initializer, key, scope, selected, deps)) return false
  if (element.initializer) deps.visitValue(element.initializer, scope, selected)
  selected.trace.origins.forEach((origin) => visit.trace.origins.add(origin))
  visit.trace.unresolved ??= selected.trace.unresolved
  return true
}

/** Visits one member of a literal, a const naming one, or a followed helper's returned value. */
function visitMember(
  node: ts.Node,
  key: string | number,
  scope: Scope,
  visit: Visit,
  deps: Deps,
): boolean {
  const value = unwrapTransparentExpression(node as ts.Expression)
  if (ts.isAwaitExpression(value)) return visitMember(value.expression, key, scope, visit, deps)
  const literal = literalMember(value, key, scope)
  if (literal !== undefined) {
    if (literal) deps.visitValue(literal, scope, visit)
    return true
  }
  if (!ts.isCallExpression(value) || visit.calls.has(value)) return false
  const followed = followedImplementations(value, scope)
  return (
    followed.length > 0 &&
    followed.every((fn) => {
      if (visit.functions.has(fn)) return false
      const next = {
        ...visit,
        seen: new Set<ts.Node>(),
        functions: new Set(visit.functions).add(fn),
        calls: new Set(visit.calls).add(value),
      }
      const bound = deps.bindArguments(fn, value, scope, next.calls)
      return returnedValues(fn).every((returned) => visitMember(returned, key, bound, next, deps))
    })
  )
}
