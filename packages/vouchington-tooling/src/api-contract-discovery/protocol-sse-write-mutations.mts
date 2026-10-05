import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { sameWriteReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
import { writeAccess } from './protocol-sse-write-resolution.mts'

export type SseWriteMutation = { node: ts.Node; receiver: ts.Expression }

export function sseWriteMutations(node: ts.Node): SseWriteMutation[] {
  return contextMutationTargets(node).flatMap((target) => {
    const access = writeAccess(target)
    return access && (access.method === 'write' || access.method === 'end')
      ? [{ node, receiver: access.receiver }]
      : []
  })
}

export function mutationAffectsSelectedStream(
  mutations: readonly SseWriteMutation[],
  frameReceivers: readonly WriteReceiver[],
  checker: ts.TypeChecker,
  isSameRoute: (node: ts.Node) => boolean,
  isInvokedHelper: (node: ts.Node) => boolean,
  resolveActual: (expression: ts.Expression) => readonly (WriteReceiver | undefined)[] | undefined,
  resolveFrame: (receiver: WriteReceiver) => readonly (WriteReceiver | undefined)[],
): boolean {
  const framed = frameReceivers.flatMap(resolveFrame)
  return mutations.some(({ node, receiver }) => {
    if (
      !potentiallyExecuted(node) ||
      (!isSourceLevelMutation(node) &&
        !executableProtocolPath(node, checker) &&
        !opaqueProtocolCallbackPath(node, checker) &&
        !isInvokedHelper(node)) ||
      !isSameRoute(node)
    )
      return false
    const actual = resolveActual(receiver)
    if (!actual) return true
    return actual.some(
      (value) =>
        value === undefined ||
        framed.some((frame) => frame === undefined || sameWriteReceiver(frame, value)),
    )
  })
}

export function isSourceLevelMutation(node: ts.Node): boolean {
  return ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent)
}
