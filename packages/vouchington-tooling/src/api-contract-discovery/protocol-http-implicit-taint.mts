import { markBufferedRouteUnavailable } from './response-contract-lenient.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'
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
