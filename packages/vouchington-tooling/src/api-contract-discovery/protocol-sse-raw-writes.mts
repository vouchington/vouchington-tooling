import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
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
import {
  isSourceLevelMutation,
  mutationAffectsSelectedStream,
  sseWriteMutation,
  type SseWriteMutation,
} from './protocol-sse-write-mutations.mts'
import { actualReceivers, helperBindings, routeKey } from './protocol-sse-write-helpers.mts'

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
  const mutations: SseWriteMutation[] = []
  for (const file of files)
    visit(file, (node) => {
      if (ts.isCallExpression(node)) calls.push(node)
      const mutation = sseWriteMutation(node)
      if (mutation) mutations.push(mutation)
    })
  for (const node of calls) {
    if (framedWrites.has(node)) {
      const binding = enclosingRouteBinding(node, checker, bindings, false)
      const route = binding && routes.get(routeKey(binding))
      const source = node.getSourceFile()
      if (
        binding &&
        route &&
        mutationAffectsSelectedStream(
          mutations,
          route.receivers,
          checker,
          (mutationNode) => {
            if (mutationNode.getSourceFile() === source && isSourceLevelMutation(mutationNode))
              return true
            const candidate = enclosingRouteBinding(mutationNode, checker, bindings, false)
            return !!candidate && routeKey(candidate) === routeKey(binding)
          },
          (expression) => {
            const receiver = expressionReceiver(expression, checker)
            return receiver && actualReceivers(receiver, binding, calls, checker, bindings)
          },
          (receiver) => actualReceivers(receiver, binding, calls, checker, bindings),
        )
      )
        reject(node, binding, route.keys)
      continue
    }
    const access = sseWriteInvocation(node, checker)
    if (!access || !access.rawBytes || !potentiallyExecuted(node)) continue
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
