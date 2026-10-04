import ts from '../contract-schema/typescript-api.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import {
  enclosingRouteBinding,
  visit,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'
import { sseWriteInvocation } from './protocol-sse-write-access.mts'

export type SseRouteWrites = { receivers: WriteReceiver[]; keys: string[] }

/** Reports unmarked writes on executable or opaque escaping paths to a selected frame's stream. */
export function rejectRawSseWrites(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  framedWrites: ReadonlySet<ts.CallExpression>,
  routes: ReadonlyMap<string, SseRouteWrites>,
  reject: (node: ts.CallExpression, binding: RouteBinding, keys: readonly string[]) => void,
): void {
  const calls: ts.CallExpression[] = []
  for (const file of files)
    visit(file, (node) => {
      if (ts.isCallExpression(node)) calls.push(node)
    })
  for (const node of calls) {
    const access = sseWriteInvocation(node, checker)
    if (framedWrites.has(node) || !access || !access.rawBytes || !potentiallyExecuted(node))
      continue
    const proven =
      executableProtocolPath(node, checker) || opaqueProtocolCallbackPath(node, checker)
    const helpers = helperBindings(node, calls, checker, bindings)
    if (!proven && !helpers.length) continue
    const binding = proven ? enclosingRouteBinding(node, checker, bindings, false) : undefined
    const candidates = binding ? [binding] : helpers
    for (const candidate of candidates) {
      const route = routes.get(routeKey(candidate))
      if (!route) continue
      if (!access.receiver) {
        reject(node, candidate, route.keys)
        continue
      }
      const receiver = expressionReceiver(access.receiver, checker)
      if (!receiver) {
        reject(node, candidate, route.keys)
        continue
      }
      const actual = actualReceivers(receiver, candidate, calls, checker, bindings)
      const framed = route.receivers.flatMap((value) =>
        actualReceivers(value, candidate, calls, checker, bindings),
      )
      if (
        actual.some(
          (value) =>
            value === undefined ||
            framed.some((frame) => frame === undefined || sameWriteReceiver(frame, value)),
        )
      )
        reject(node, candidate, route.keys)
    }
  }
}

function routeKey(binding: RouteBinding): string {
  return `${binding.method}:${binding.routeTemplate}`
}

function implementationDeclaration(
  declaration: ts.Signature['declaration'],
  checker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | undefined {
  if (!declaration) return undefined
  if (ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) return declaration
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) {
    if (declaration.body) return declaration
    const symbol = declaration.name && checker.getSymbolAtLocation(declaration.name)
    return symbol?.declarations?.find(
      (candidate): candidate is ts.FunctionLikeDeclaration =>
        (ts.isFunctionDeclaration(candidate) || ts.isMethodDeclaration(candidate)) &&
        !!candidate.body,
    )
  }
  return undefined
}

function helperBindings(
  node: ts.Node,
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
): RouteBinding[] {
  const fn = enclosingFunction(node)
  if (!fn || fn.asteriskToken) return []
  return calls.flatMap((call) => {
    if (
      implementationDeclaration(checker.getResolvedSignature(call)?.declaration, checker) !== fn ||
      !executableProtocolPath(call, checker)
    )
      return []
    const binding = enclosingRouteBinding(call, checker, bindings, false)
    return binding ? [binding] : []
  })
}

function actualReceivers(
  receiver: WriteReceiver,
  binding: RouteBinding,
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
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
  const actuals = calls.flatMap((call) => {
    if (
      implementationDeclaration(checker.getResolvedSignature(call)?.declaration, checker) !== fn ||
      !executableProtocolPath(call, checker)
    )
      return []
    const callBinding = enclosingRouteBinding(call, checker, bindings, false)
    if (!callBinding || routeKey(callBinding) !== routeKey(binding)) return []
    const argument = call.arguments[index] ?? declaration.initializer
    const actual = argument && expressionReceiver(argument, checker)
    // A forwarded object path requires a stable property proof; don't invent one.
    if (!actual || receiver.path.length) return [undefined]
    return actualReceivers(
      actual,
      binding,
      calls,
      checker,
      bindings,
      new Set(active).add(receiver.root),
    )
  })
  return actuals.length ? actuals : [receiver]
}
