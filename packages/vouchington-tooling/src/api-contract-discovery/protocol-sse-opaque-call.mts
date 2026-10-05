import {
  containsSelectedSseOrigin,
  selectedSseOriginUnexposed,
} from './protocol-sse-selected-origin.mts'
import { platformCallbackArgument } from './protocol-platform-callbacks.mts'
import { callbackCapturesSelectedReceiver } from './protocol-sse-callback-capture.mts'
import { actualReceivers } from './protocol-sse-actual-receivers.mts'
import {
  selectedReturnedSseCapability,
  selectedOpaqueSseReceiver,
  sseCallableAlias,
} from './protocol-sse-returned-capability.mts'
import ts from '../contract-schema/typescript-api.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import {
  opaqueArgumentExcludesSelectedStream,
  selectedStreamHasFreshOrigin,
} from './protocol-sse-opaque-identity.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
type SseWriteLookup = {
  implementationCall: (call: ts.CallExpression) => ts.Node | undefined
  callsFor: (fn: ts.FunctionLikeDeclaration, binding: RouteBinding) => ts.CallExpression[]
}
export function opaqueCallReceivesSelectedStream(
  call: ts.CallExpression | ts.NewExpression,
  selectedReceivers: readonly WriteReceiver[],
  binding: RouteBinding,
  checker: ts.TypeChecker,
  lookup: SseWriteLookup,
): boolean {
  const implementation = ts.isCallExpression(call) && lookup.implementationCall(call)
  if (implementation && ts.isFunctionLike(implementation) && 'body' in implementation) return false
  const framed = selectedReceivers.flatMap((frame) =>
    actualReceivers(frame, binding, checker, lookup).map((value) => value ?? frame),
  )
  if (
    selectedOpaqueSseReceiver(call, checker, framed, (receiver) =>
      actualReceivers(receiver, binding, checker, lookup),
    )
  )
    return true
  return (
    call.arguments?.some((argument) =>
      someSseArgumentValue(argument, checker, (leaf) => {
        if (containsSelectedSseOrigin(leaf, framed, checker)) return true
        const callback =
          ts.isArrowFunction(leaf) || ts.isFunctionExpression(leaf)
            ? leaf
            : sseCallableAlias(leaf, checker)
        if (
          callback &&
          platformCallbackArgument(call, checker) !== leaf &&
          framed.some((frame) => callbackCapturesSelectedReceiver(callback, frame, checker))
        )
          return true
        if (
          (ts.isCallExpression(leaf) || callback) &&
          selectedReturnedSseCapability(
            leaf,
            checker,
            lookup.implementationCall,
            framed,
            (receiver) => actualReceivers(receiver, binding, checker, lookup),
          )
        )
          return true
        if (callback && selectedSseOriginUnexposed(framed, checker, selectedStreamHasFreshOrigin))
          return false
        const receiver = expressionReceiver(leaf, checker)

        if (!receiver) return false
        if (
          !receiver.mutableAlias &&
          opaqueArgumentExcludesSelectedStream(call, leaf, receiver, framed, checker)
        )
          return false
        const values = actualReceivers(receiver, binding, checker, lookup)
        // Resolve known helper forwarding before requiring independent allocation evidence.
        return (
          !values.length ||
          values.some(
            (value) =>
              value === undefined ||
              !opaqueArgumentExcludesSelectedStream(call, leaf, value, framed, checker),
          )
        )
      }),
    ) ?? false
  )
}
