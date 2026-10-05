import type ts from '../contract-schema/typescript-api.mts'

import { discoverApiHeaderContracts } from './header-contract-registry.mts'
import { discoverApiQueryContracts } from './query-contract-registry.mts'
import { discoverRegisteredRoutes } from './registered-route-catalog.mts'
import { discoverApiRequestContracts } from './request-contract-registry.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import type { DiscoverApiResponseContractsOptions } from './response-contract-lenient.mts'

export const APP_ROUTE_CTX_ADAPTER_VERSION = 1 as const

export type AppRouteCtxDiscoveryInput = {
  program: ts.Program
  sourceFiles: readonly ts.SourceFile[]
  requestedKeys?: ReadonlySet<string>
  options?: DiscoverApiResponseContractsOptions
}

/** Discovers the version-one `app.route(...).method(handler)` and `ctx` convention. */
export function discoverAppRouteCtxContractsV1(input: AppRouteCtxDiscoveryInput) {
  const { program, sourceFiles, requestedKeys, options } = input
  const responses = discoverApiResponseContracts(program, sourceFiles, requestedKeys, options)
  const knownResponseRoutes = new Set(Object.keys(responses))
  return {
    adapterVersion: APP_ROUTE_CTX_ADAPTER_VERSION,
    routes: discoverRegisteredRoutes(program, sourceFiles),
    responses,
    requests: discoverApiRequestContracts(program, sourceFiles, requestedKeys, options),
    queries: discoverApiQueryContracts(program, sourceFiles, knownResponseRoutes),
    headers: discoverApiHeaderContracts(program, sourceFiles, knownResponseRoutes),
  }
}

export { discoverApiResponseContracts } from './response-contract-registry.mts'
export { discoverApiRequestContracts } from './request-contract-registry.mts'
export { discoverApiQueryContracts } from './query-contract-registry.mts'
export { discoverApiHeaderContracts } from './header-contract-registry.mts'
export { discoverRegisteredRoutes, routeShape } from './registered-route-catalog.mts'
export { responseStatusCodesForContract } from './response-contract-status.mts'
export type { BackendResponseContract } from './response-contract-types.mts'
export type { BackendRequestContract } from './request-contract-types.mts'
export type { BackendQueryContract, BackendQueryContractRegistry } from './query-contract-types.mts'
export type { HeaderContract, HeaderContractRegistry } from './header-contract-types.mts'
export type { RegisteredRoute } from './registered-route-catalog.mts'
export type {
  AmbiguousAttributionFact,
  RouteDiscoveryError,
  DiscoverApiResponseContractsOptions,
} from './response-contract-lenient.mts'
export type { DiscoverApiRequestContractsOptions } from './request-contract-lenient.mts'
