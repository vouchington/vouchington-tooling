import ts from '../contract-schema/typescript-api.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import {
  enclosingRouteBinding,
  visit,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'
import { sameWriteReceiver, writeReceiver, type WriteReceiver } from './protocol-write-receiver.mts'

export type SseRouteWrites = { receivers: WriteReceiver[]; keys: string[] }

/** Reports only executable unmarked writes to a selected frame's stream. */
export function rejectRawSseWrites(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  framedWrites: ReadonlySet<ts.CallExpression>,
  routes: ReadonlyMap<string, SseRouteWrites>,
  reject: (node: ts.CallExpression, binding: RouteBinding, keys: readonly string[]) => void,
): void {
  for (const file of files)
    visit(file, (node) => {
      if (
        !ts.isCallExpression(node) ||
        framedWrites.has(node) ||
        !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== 'write' ||
        !executableProtocolPath(node, checker)
      )
        return
      const binding = enclosingRouteBinding(node, checker, bindings, false)
      if (!binding) return
      const route = routes.get(`${binding.method}:${binding.routeTemplate}`)
      if (
        route?.receivers.some((receiver) =>
          sameWriteReceiver(receiver, writeReceiver(node, checker)),
        )
      )
        reject(node, binding, route.keys)
    })
}
