import { containsSelectedSseOrigin } from './protocol-sse-selected-origin.mts'
import { platformCallbackArgument } from './protocol-platform-callbacks.mts'
import { callbackCapturesSelectedReceiver } from './protocol-sse-callback-capture.mts'
import { actualReceivers } from './protocol-sse-actual-receivers.mts'
import { createSseCallbackOrigins } from './protocol-sse-callback-origins.mts'
import {
  implementationDeclaration,
  selectedReturnedSseCapability,
} from './protocol-sse-returned-capability.mts'
import ts from '../contract-schema/typescript-api.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
} from './protocol-callback-values.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueArgumentExcludesSelectedStream } from './protocol-sse-opaque-identity.mts'
import {
  enclosingRouteBinding,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'

export function routeKey(binding: RouteBinding): string {
  return `${binding.method}:${binding.routeTemplate}`
}

type SseWriteLookup = ReturnType<typeof createSseWriteLookup>

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
  return (
    call.arguments?.some((argument) =>
      someSseArgumentValue(argument, checker, (leaf) => {
        if (containsSelectedSseOrigin(leaf, framed, checker)) return true
        if (
          (ts.isArrowFunction(leaf) || ts.isFunctionExpression(leaf)) &&
          platformCallbackArgument(call, checker) !== leaf &&
          framed.some((frame) => callbackCapturesSelectedReceiver(leaf, frame, checker))
        )
          return true
        if (
          ts.isCallExpression(leaf) &&
          selectedReturnedSseCapability(
            leaf,
            checker,
            lookup.implementationCall,
            framed,
            (receiver) => actualReceivers(receiver, binding, checker, lookup),
          )
        )
          return true
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

export function createSseWriteLookup(
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  files: readonly ts.SourceFile[] = calls.map((call) => call.getSourceFile()),
): {
  implementationCall: (call: ts.CallExpression) => ts.Node | undefined
  actualImplementationCall: (call: ts.CallExpression, binding?: RouteBinding) => ts.Node | undefined
  callsFor: (fn: ts.FunctionLikeDeclaration, binding: RouteBinding) => ts.CallExpression[]
  helperBindings: (node: ts.Node) => RouteBinding[]
  reachableCalls: () => readonly ts.CallExpression[]
} {
  const indexedSources = new Set(files)
  const callbackValues = createProtocolCallbackValueResolver(checker)
  const implementations = new Map<ts.CallExpression, ts.Node | undefined>()
  const callers = new Map<
    ts.FunctionLikeDeclaration,
    { call: ts.CallExpression; binding: RouteBinding }[]
  >()
  let callersIndexed = false
  const origins = createSseCallbackOrigins(calls, checker)

  function lookupImplementation(call: ts.CallExpression): ts.Node | undefined {
    if (implementations.has(call)) return implementations.get(call)
    const implementation =
      implementationDeclaration(checker.getResolvedSignature(call)?.declaration, checker) ??
      callbackValues.resolve(call.expression, new Map())?.node
    implementations.set(call, implementation)
    return implementation
  }

  function indexedImplementation(call: ts.CallExpression): ts.Node | undefined {
    const implementation = lookupImplementation(call)
    return implementation && indexedSources.has(implementation.getSourceFile())
      ? implementation
      : undefined
  }

  function indexCallers(): void {
    if (callersIndexed) return
    callersIndexed = true
    for (const { callback, call, binding } of origins.invocations) {
      const entries = callers.get(callback) ?? []
      entries.push({ call, binding })
      callers.set(callback, entries)
    }
    for (const call of calls) {
      const implementation = indexedImplementation(call)
      if (
        !implementation ||
        !isProtocolCallbackFunction(implementation) ||
        !executableProtocolPath(call, checker)
      )
        continue
      const binding = enclosingRouteBinding(call, checker, bindings, false)
      if (!binding) continue
      const matches = callers.get(implementation) ?? []
      matches.push({ call, binding })
      callers.set(implementation, matches)
    }
  }

  function lookupCalls(fn: ts.FunctionLikeDeclaration, binding: RouteBinding): ts.CallExpression[] {
    indexCallers()
    return (
      callers
        .get(fn)
        ?.filter((callSite) => routeKey(callSite.binding) === routeKey(binding))
        .map(({ call }) => call) ?? []
    )
  }

  function lookupHelpers(node: ts.Node): RouteBinding[] {
    const fn = enclosingFunction(node)
    if (!fn || fn.asteriskToken) return []
    indexCallers()
    return callers.get(fn)?.map(({ binding }) => binding) ?? []
  }

  return {
    implementationCall: indexedImplementation,
    actualImplementationCall: (call, binding) => {
      const selected = origins.invocations.filter(
        (origin) =>
          origin.call === call && (!binding || routeKey(origin.binding) === routeKey(binding)),
      )
      if (selected.length)
        return selected.every((origin) => origin.callback === selected[0]!.callback)
          ? selected[0]!.callback
          : undefined
      return lookupImplementation(call)
    },
    callsFor: lookupCalls,
    helperBindings: lookupHelpers,
    reachableCalls: () => origins.handlerCalls,
  }
}

export { actualReceivers } from './protocol-sse-actual-receivers.mts'
