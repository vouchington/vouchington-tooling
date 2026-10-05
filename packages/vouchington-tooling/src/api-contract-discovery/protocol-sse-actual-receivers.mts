import { ownerHasFreshAllocation } from './protocol-sse-owner-allocation.mts'
import ts from '../contract-schema/typescript-api.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
type SseWriteLookup = {
  callsFor: (fn: ts.FunctionLikeDeclaration, binding: RouteBinding) => ts.CallExpression[]
}

export function actualReceivers(
  receiver: WriteReceiver,
  binding: RouteBinding,
  checker: ts.TypeChecker,
  lookup: SseWriteLookup,
  active = new Set<ts.Symbol>(),
): (WriteReceiver | undefined)[] {
  const declaration = receiver.root.valueDeclaration
  if (
    receiver.mutableAlias ||
    (declaration &&
      (ts.isBindingElement(declaration) ||
        (ts.isVariableDeclaration(declaration) &&
          !(declaration.parent.flags & ts.NodeFlags.Const) &&
          !ownerHasFreshAllocation(receiver, checker)) ||
        (ts.isParameter(declaration) && hasBindingWrite(declaration, checker))))
  )
    return [undefined]
  const fn = declaration && enclosingFunction(declaration)
  if (!declaration || !ts.isParameter(declaration) || !fn) return [receiver]
  if (active.has(receiver.root)) return [undefined]
  const index = runtimeParameters(fn).indexOf(declaration)
  const actuals = lookup.callsFor(fn, binding).flatMap((call) => {
    const argument = call.arguments[index] ?? declaration.initializer
    const actual = argument && expressionReceiver(argument, checker)
    if (!actual || receiver.path.length) return [undefined]
    return actualReceivers(actual, binding, checker, lookup, new Set(active).add(receiver.root))
  })
  return actuals.length ? actuals : [receiver]
}
