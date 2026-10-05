import { markBufferedRouteUnavailable } from './response-contract-lenient.mts'
import {
  enclosingRouteBinding,
  requestedKeyForBinding,
  type RouteBinding,
  type HandlerBindings,
} from './response-contract-route-analysis.mts'
import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { httpHandlerContext, opaqueHttpContextConstruction } from './protocol-http-context.mts'
import { sourceLocation } from './response-contract-registration.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

/** Only already-selected route rows are tainted; implicit-only routes use their requested key. */
export function taintRouteKeys(
  contracts: Map<string, BackendResponseContract>,
  binding: RouteBinding,
  key: string | undefined,
): string[] {
  const keys = [...contracts]
    .filter(
      ([, row]) => row.method === binding.method && row.routeTemplate === binding.routeTemplate,
    )
    .map(([key]) => key)
  return keys.length ? keys : key ? [key] : []
}

export function markRouteTaint(
  contracts: Map<string, BackendResponseContract>,
  keys: readonly string[],
  binding: RouteBinding,
  source: string,
  mutable: boolean,
): void {
  for (const key of keys) {
    if (contracts.get(key)?.unavailableReason) continue
    markBufferedRouteUnavailable(contracts, key, binding, source)
    if (mutable)
      contracts.get(key)!.unavailableReason =
        'route emits a response through a mutable context wrapper whose status or body is not statically determinable'
  }
}

/** A direct setter is already covered by a successfully extracted matching SSE contract. */
export function isSseSetter(
  contracts: Map<string, BackendResponseContract>,
  binding: RouteBinding,
  method: string | undefined,
): boolean {
  return (
    method === 'setStatus' &&
    [...contracts.values()].some(
      (row) =>
        row.method === binding.method &&
        row.routeTemplate === binding.routeTemplate &&
        !row.unavailableReason &&
        !!row.sseEvents?.length,
    )
  )
}

/** Constructors cannot retain the selected registered context behind a declared empty row. */
export function taintContextConstruction(
  node: ts.NewExpression,
  checker: ts.TypeChecker,
  contracts: Map<string, BackendResponseContract>,
  handlers: HandlerBindings,
  requestedKeys?: ReadonlySet<string>,
): void {
  const handler = enclosingFunction(node)
  const context = handler && httpHandlerContext(handler, checker)
  if (!context || !opaqueHttpContextConstruction(node, checker, context)) return
  const binding = enclosingRouteBinding(node, checker, handlers)
  if (!binding) return
  const keys = taintRouteKeys(contracts, binding, requestedKeyForBinding(binding, requestedKeys))
  markRouteTaint(contracts, keys, binding, sourceLocation(node.getSourceFile(), node), false)
}
