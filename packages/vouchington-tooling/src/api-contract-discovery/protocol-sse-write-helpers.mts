import { implementationDeclaration } from './protocol-sse-implementation.mts'
import { createSseTagCallers } from './protocol-sse-tag-callers.mts'
import {
  selectedReturnedSseCapability,
  selectedOpaqueSseReceiver,
  sseCallableAlias,
} from './protocol-sse-returned-capability.mts'
import ts from '../contract-schema/typescript-api.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
} from './protocol-callback-values.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import {
  enclosingRouteBinding,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'

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
  const framed = selectedReceivers.flatMap((receiver) =>
    actualReceivers(receiver, binding, checker, lookup),
  )
  if (
    selectedOpaqueSseReceiver(call, checker, framed, (receiver) =>
      actualReceivers(receiver, binding, checker, lookup),
    )
  )
    return true
  return (
    call.arguments?.some((argument) =>
      someSseArgumentValue(argument, checker, (value) => {
        if (
          (ts.isIdentifier(value) ||
            ts.isCallExpression(value) ||
            ts.isNewExpression(value) ||
            sseCallableAlias(value, checker) ||
            ts.isArrowFunction(value) ||
            ts.isFunctionExpression(value)) &&
          selectedReturnedSseCapability(
            value,
            checker,
            lookup.implementationCall,
            framed,
            (receiver) => actualReceivers(receiver, binding, checker, lookup),
          )
        )
          return true
        const receiver = expressionReceiver(value, checker)
        if (!receiver) return false
        return actualReceivers(receiver, binding, checker, lookup).some(
          (value) =>
            value === undefined ||
            framed.some((frame) => frame === undefined || sameWriteReceiver(frame, value)),
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
  tags: readonly ts.TaggedTemplateExpression[] = [],
): {
  implementationCall: (call: ts.CallExpression) => ts.Node | undefined
  callsFor: (fn: ts.FunctionLikeDeclaration, binding: RouteBinding) => ts.CallExpression[]
  helperBindings: (node: ts.Node) => RouteBinding[]
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

  function lookupImplementation(call: ts.CallExpression): ts.Node | undefined {
    if (implementations.has(call)) return implementations.get(call)
    const implementation =
      implementationDeclaration(checker.getResolvedSignature(call)?.declaration, checker) ??
      callbackValues.resolve(call.expression, new Map())?.node
    const indexed =
      implementation && indexedSources.has(implementation.getSourceFile())
        ? implementation
        : undefined
    implementations.set(call, indexed)
    return indexed
  }

  function indexCallers(): void {
    if (callersIndexed) return
    callersIndexed = true
    for (const call of calls) {
      const implementation = lookupImplementation(call)
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
    implementationCall: lookupImplementation,
    callsFor: lookupCalls,
    helperBindings: lookupHelpers,
  }
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
          !(declaration.parent.flags & ts.NodeFlags.Const)) ||
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
