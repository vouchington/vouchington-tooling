import { unconditionalSsePipeline } from './protocol-sse-pipeline-execution.mts'
import ts from '../contract-schema/typescript-api.mts'
import { contextResponseMethod } from './protocol-http-context.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { enclosingRouteBinding, type HandlerBindings } from './response-contract-route-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { createSseWriteLookup, routeKey } from './protocol-sse-write-helpers.mts'
import type { SseRouteWrites } from './protocol-sse-raw-writes.mts'
import { factoryPipeline } from './protocol-sse-pipeline-origin.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

/** A validated frame accounts only for its own route's exact stream pipeline invocation. */
export function createSseAccountedPipeline(
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  routes: ReadonlyMap<string, SseRouteWrites>,
  contracts: ReadonlyMap<string, BackendResponseContract>,
) {
  const lookup = createSseWriteLookup(calls, checker, bindings)
  return (
    call: ts.CallExpression,
    context: ts.Symbol,
    invocation: ts.CallExpression,
    root: ts.CallExpression,
  ): boolean => {
    if (contextResponseMethod(call.expression, context, checker) !== 'pipeline') return false
    const fn = enclosingFunction(call)
    const name = fn && runtimeParameters(fn)[0]?.name
    if (!fn || !name || !ts.isIdentifier(name) || checker.getSymbolAtLocation(name) !== context)
      return false
    if (!unconditionalSsePipeline(call, fn)) return false
    const binding = enclosingRouteBinding(root, checker, bindings, false)
    const route = binding && routes.get(routeKey(binding))
    if (
      !binding ||
      !route ||
      !route.keys.every((key) => {
        const row = contracts.get(key)
        return !!row && !row.unavailableReason && !!row.sseEvents?.length
      })
    )
      return false
    const argument = call.arguments[0]
    const stream = argument && expressionReceiver(argument, checker)
    if (!stream || stream.mutableAlias) return false
    const invocations =
      invocation === call && root === call ? lookup.callsFor(fn, binding) : [invocation]
    return (
      invocations.length > 0 &&
      invocations.every(
        (selected) =>
          lookup.actualImplementationCall(selected) === fn &&
          route.receivers.some((frame) => {
            return factoryPipeline(frame, selected, fn, stream, checker)
          }),
      )
    )
  }
}
