import ts from '../contract-schema/typescript-api.mts'
import { associateHttpResponse } from './protocol-http-association.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { statusDominatesEmission } from './protocol-status-dominance.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

export type PendingHttp = {
  call: ts.CallExpression
  symbol: ts.Symbol
  keys: string[]
  binding: RouteBinding
  variants: Omit<BackendResponseContract, 'method' | 'routeTemplate'>[]
  declaredBodyKinds: ReadonlySet<'content' | 'none'>
}

export function registerHttpProtocols(
  pending: readonly PendingHttp[],
  contracts: Map<string, BackendResponseContract>,
  checker: ts.TypeChecker,
  reject: (response: PendingHttp, error: unknown) => void,
): Set<ts.CallExpression> {
  const covered = new Set<ts.CallExpression>()
  const groups = new Map<ts.Node | undefined, PendingHttp[]>()
  for (const response of pending) {
    const handler = enclosingFunction(response.call)
    const group = groups.get(handler) ?? []
    group.push(response)
    groups.set(handler, group)
  }
  for (const group of groups.values()) {
    if (!group.some((response) => response.keys.length)) continue
    try {
      const siblings = new Set(group.map((response) => response.symbol))
      const associations = new Map(
        group.map((response) => [
          response,
          associateHttpResponse(response.call, response.symbol, checker, siblings),
        ]),
      )
      const allStatuses = new Set(
        [...associations.values()].flatMap((emissions) =>
          [...emissions].filter(([, kind]) => kind === 'status').map(([call]) => call),
        ),
      )
      const proven = new Set<ts.CallExpression>()
      for (const [response, emissions] of associations) {
        proveHttpEmissions(response, emissions, allStatuses)
        for (const call of emissions.keys()) proven.add(call)
      }
      // Every sibling must prove its own emissions before any group contract is published.
      for (const response of group)
        response.variants.forEach((variant, index) =>
          contracts.set(response.keys[index]!, { ...variant, ...response.binding }),
        )
      for (const call of proven) covered.add(call)
    } catch (error) {
      for (const response of group) if (response.keys.length) reject(response, error)
    }
  }
  return covered
}

function proveHttpEmissions(
  response: PendingHttp,
  emissions: Map<ts.CallExpression, 'content' | 'none' | 'status'>,
  allStatuses: ReadonlySet<ts.CallExpression>,
): void {
  const statuses = new Set(
    [...emissions].filter(([, kind]) => kind === 'status').map(([call]) => call),
  )
  const kinds = new Set(emissions.values())
  const declaredBodyKinds = response.declaredBodyKinds
  if (
    !kinds.has('status') ||
    [...declaredBodyKinds].some((kind) => !kinds.has(kind)) ||
    [...kinds].some((kind) => kind !== 'status' && !declaredBodyKinds.has(kind)) ||
    [...emissions].some(
      ([call, kind]) => kind !== 'status' && !statusDominatesEmission(call, statuses, allStatuses),
    )
  )
    throw new Error(
      'HTTP response variants require dominating status and associated body emissions',
    )
}
