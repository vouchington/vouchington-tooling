import { collectSseInvocations } from './protocol-sse-invocations.mts'
import { selectedSseTagReceiver } from './protocol-sse-tag-arguments.mts'
import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
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
import { sseWriteInvocation } from './protocol-sse-write-access.mts'
import {
  isSourceLevelMutation,
  mutationAffectsSelectedStream,
} from './protocol-sse-write-mutations.mts'
import {
  actualReceivers,
  createSseWriteLookup,
  opaqueCallReceivesSelectedStream,
  routeKey,
} from './protocol-sse-write-helpers.mts'
import { importedSseCallSafe } from './protocol-sse-imported-call.mts'
import { writeAccess } from './protocol-sse-write-resolution.mts'

export type SseRouteWrites = { receivers: WriteReceiver[]; keys: string[] }

/** Reports unmarked writes on executable or opaque escaping paths to a selected frame's stream. */
export function rejectRawSseWrites(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  framedWrites: ReadonlySet<ts.CallExpression>,
  routes: ReadonlyMap<string, SseRouteWrites>,
  reject: (
    node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
    binding: RouteBinding,
    keys: readonly string[],
  ) => void,
): void {
  if (routes.size === 0) return

  const { invocations, mutations } = collectSseInvocations(files)
  const calls = invocations.filter(ts.isCallExpression)
  const lookup = createSseWriteLookup(
    calls,
    checker,
    bindings,
    files,
    invocations.filter(ts.isTaggedTemplateExpression),
  )
  for (const call of lookup.reachableCalls())
    if (!invocations.includes(call)) invocations.push(call)
  for (const node of invocations) {
    if (ts.isCallExpression(node) && framedWrites.has(node)) {
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
            if (candidate && routeKey(candidate) === routeKey(binding)) return true
            if (
              !candidate &&
              mutationNode.getSourceFile() === source &&
              opaqueProtocolCallbackPath(mutationNode, checker)
            )
              return true
            return lookup
              .helperBindings(mutationNode)
              .some((helper) => routeKey(helper) === routeKey(binding))
          },
          (mutationNode) => lookup.helperBindings(mutationNode).length > 0,
          (expression) => {
            const receiver = expressionReceiver(expression, checker)
            return receiver && actualReceivers(receiver, binding, checker, lookup)
          },
          (receiver) => actualReceivers(receiver, binding, checker, lookup),
        )
      )
        reject(node, binding, route.keys)
      continue
    }
    const access = ts.isCallExpression(node) ? sseWriteInvocation(node, checker) : undefined
    if (!potentiallyExecuted(node)) continue
    const proven =
      executableProtocolPath(node, checker) || opaqueProtocolCallbackPath(node, checker)
    const helpers = lookup.helperBindings(node)
    if (!proven && !helpers.length) continue
    const binding = proven ? enclosingRouteBinding(node, checker, bindings, false) : undefined
    const candidates = binding ? [binding] : helpers
    for (const candidate of candidates) {
      const route = routes.get(routeKey(candidate))
      if (!route) continue
      if (ts.isTaggedTemplateExpression(node)) {
        if (
          selectedSseTagReceiver(node, checker, route.receivers, (receiver) =>
            actualReceivers(receiver, candidate, checker, lookup),
          )
        )
          reject(node, candidate, route.keys)
        continue
      }
      const receiver = access?.receiver && expressionReceiver(access.receiver, checker)
      const actual = receiver ? actualReceivers(receiver, candidate, checker, lookup) : []
      const framed = route.receivers.flatMap((value) =>
        actualReceivers(value, candidate, checker, lookup),
      )
      const bound = ts.isCallExpression(node) ? writeAccess(node.expression) : undefined
      const boundReceiver = bound?.method === 'bind' && expressionReceiver(bound.receiver, checker)
      const boundActual = boundReceiver
        ? actualReceivers(boundReceiver, candidate, checker, lookup)
        : []
      const accessTargetsSelected =
        (access?.method === 'write' || access?.method === 'end') &&
        actual.some(
          (value) =>
            value !== undefined &&
            framed.some((frame) => frame !== undefined && sameWriteReceiver(frame, value)),
        )
      const bindsSelectedMember =
        bound?.method === 'bind' &&
        boundActual.some(
          (value) =>
            value !== undefined &&
            framed.some(
              (frame) =>
                frame !== undefined &&
                frame.root === value.root &&
                value.path.length > frame.path.length &&
                value.path.slice(0, frame.path.length).join('.') === frame.path.join('.'),
            ),
        )
      if (
        !accessTargetsSelected &&
        !bindsSelectedMember &&
        opaqueCallReceivesSelectedStream(node, route.receivers, candidate, checker, lookup) &&
        !(
          ts.isCallExpression(node) &&
          importedSseCallSafe(node, route.receivers, candidate, checker, lookup, framedWrites)
        )
      ) {
        reject(node, candidate, route.keys)
        continue
      }
      if (!access || !access.rawBytes) continue
      if (!access.receiver) {
        reject(node, candidate, route.keys)
        continue
      }
      if (!receiver) {
        reject(node, candidate, route.keys)
        continue
      }
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
