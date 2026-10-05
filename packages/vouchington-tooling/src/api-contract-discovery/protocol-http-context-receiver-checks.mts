import ts from '../contract-schema/typescript-api.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import {
  createProtocolCallbackValueResolver,
  type CallbackBindings,
} from './protocol-callback-values.mts'
import { contextForwardedTarget } from './protocol-http-context-forwarded-target.mts'
import type { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import type { createLiteralWrapperIndex } from './protocol-http-context-literal-wrappers.mts'

/** Receiver obligations use the selected caller bindings and are never cached across callers. */
export function createContextReceiverChecks(
  checker: ts.TypeChecker,
  roots: ReturnType<typeof createContextValueRoots>,
  dataForSymbol: (symbol: ts.Symbol) => readonly {
    calls: readonly (ts.CallExpression | ts.NewExpression)[]
    wrappers: ReturnType<typeof createLiteralWrapperIndex>
  }[],
  stable: (symbol: ts.Symbol) => boolean,
  immutableFunction: (symbol: ts.Symbol) => boolean,
) {
  const { root, primitiveMember } = roots
  const callbacks = createProtocolCallbackValueResolver(checker)
  const calls = new Map<
    ts.CallExpression | ts.NewExpression,
    {
      receiver: ts.Symbol | undefined
      arguments: { index: number; symbols: ReadonlySet<ts.Symbol>; primitive: boolean }[]
    }
  >()
  function origins(
    call: ts.CallExpression | ts.NewExpression,
    capture: ReturnType<typeof createLiteralWrapperIndex>['capture'],
  ) {
    const hit = calls.get(call)
    if (hit) return hit
    const expression = call.expression
    const row = {
      receiver:
        ts.isCallExpression(call) &&
        (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
          ? root(expression.expression)
          : undefined,
      arguments: [...(call.arguments ?? [])].map((argument, index) => ({
        index,
        symbols: new Set([
          ...capture(argument),
          ...[root(argument)].filter((symbol): symbol is ts.Symbol => !!symbol),
        ]),
        primitive: primitiveMember(argument),
      })),
    }
    calls.set(call, row)
    return row
  }
  function receivers(
    symbol: ts.Symbol,
    env: CallbackBindings,
    inspect: (call: ts.CallExpression, env: CallbackBindings) => boolean,
    active = new Set<ts.Symbol>(),
  ): boolean {
    if (!stable(symbol) || active.has(symbol)) return false
    if (immutableFunction(symbol)) return true
    const next = new Set(active).add(symbol)
    for (const data of dataForSymbol(symbol)) {
      for (const call of data.calls) {
        const origin = origins(call, data.wrappers.capture)
        if (ts.isCallExpression(call) && origin.receiver === symbol && !inspect(call, env))
          return false
        for (const { index, symbols, primitive } of origin.arguments) {
          if (!symbols.has(symbol) || primitive) continue
          // The same static call and argument root already passed stable(symbol).
          const { implementation, binding } = contextForwardedTarget(checker, call, index)!
          const bindings = callbackArgumentBindings(
            implementation,
            call,
            env,
            env,
            checker,
            callbacks,
          )
          if (!bindings || !receivers(binding, bindings, inspect, next)) return false
        }
      }
    }
    return true
  }
  return receivers
}
