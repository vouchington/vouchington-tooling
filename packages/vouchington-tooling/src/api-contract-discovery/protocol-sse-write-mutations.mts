import ts from '../contract-schema/typescript-api.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { sameWriteReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
import { writeAccess } from './protocol-sse-write-resolution.mts'

export type SseWriteMutation = { node: ts.Node; receiver: ts.Expression }

export function sseWriteMutation(node: ts.Node): SseWriteMutation | undefined {
  if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
    const access = writeAccess(node.left)
    if (access && (access.method === 'write' || access.method === 'end'))
      return { node, receiver: access.receiver }
  }
  if (ts.isDeleteExpression(node)) {
    const access = writeAccess(node.expression)
    if (access && (access.method === 'write' || access.method === 'end'))
      return { node, receiver: access.receiver }
  }
  return undefined
}

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
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
