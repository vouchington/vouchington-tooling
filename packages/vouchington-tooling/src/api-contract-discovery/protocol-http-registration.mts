import ts from '../contract-schema/typescript-api.mts'
import { associateHttpResponse } from './protocol-http-association.mts'
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
  for (const response of pending) {
    try {
      const emissions = associateHttpResponse(response.call, response.symbol, checker)
      const statuses = new Set(
        [...emissions].filter(([, kind]) => kind === 'status').map(([call]) => call),
      )
      const kinds = new Set(emissions.values())
      if (
        !kinds.has('status') ||
        [...response.declaredBodyKinds].some((kind) => !kinds.has(kind)) ||
        [...kinds].some((kind) => kind !== 'status' && !response.declaredBodyKinds.has(kind)) ||
        [...emissions].some(
          ([call, kind]) => kind !== 'status' && !statusDominatesEmission(call, statuses),
        )
      )
        throw new Error(
          'HTTP response variants require dominating status and associated body emissions',
        )
      response.variants.forEach((variant, index) =>
        contracts.set(response.keys[index]!, { ...variant, ...response.binding }),
      )
      for (const call of emissions.keys()) covered.add(call)
    } catch (error) {
      reject(response, error)
    }
  }
  return covered
}
