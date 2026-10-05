import { createSseTagCallers } from './protocol-sse-tag-callers.mts'
import { createSseCallbackOrigins } from './protocol-sse-callback-origins.mts'
import { implementationDeclaration } from './protocol-sse-returned-capability.mts'
import ts from '../contract-schema/typescript-api.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
} from './protocol-callback-values.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import {
  enclosingRouteBinding,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'

export function routeKey(binding: RouteBinding): string {
  return `${binding.method}:${binding.routeTemplate}`
}

export function createSseWriteLookup(
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  files: readonly ts.SourceFile[] = calls.map((call) => call.getSourceFile()),
  tags: readonly ts.TaggedTemplateExpression[] = [],
): {
  implementationCall: (call: ts.CallExpression) => ts.Node | undefined
  actualImplementationCall: (call: ts.CallExpression, binding?: RouteBinding) => ts.Node | undefined
  callsFor: (fn: ts.FunctionLikeDeclaration, binding: RouteBinding) => ts.CallExpression[]
  helperBindings: (node: ts.Node) => RouteBinding[]
  reachableCalls: () => readonly ts.CallExpression[]
} {
  const tagCallers = createSseTagCallers(tags, checker, bindings, files)
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
    return [...(callers.get(fn)?.map(({ binding }) => binding) ?? []), ...tagCallers(fn)]
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

export { opaqueCallReceivesSelectedStream } from './protocol-sse-opaque-call.mts'
