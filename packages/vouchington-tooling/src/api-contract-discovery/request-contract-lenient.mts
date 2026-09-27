import { hashContractSchema } from '../contract-schema/index.mts'
import type {
  ContractSchema,
  ExtractedResponseContract,
  ExtractContractSchemaOptions,
} from '../contract-schema/index.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'
import type { RouteDiscoveryError } from './response-contract-lenient.mts'
import type { BackendRequestContract } from './request-contract-types.mts'

export type DiscoverApiRequestContractsOptions = ExtractContractSchemaOptions & {
  onRouteError?: (error: RouteDiscoveryError) => void
}

/** Placeholder contract for a route whose request body could not be extracted. */
function unavailableRequestContract(
  source: string,
  reason: string,
): ExtractedResponseContract & { unavailableReason: string } {
  const schema: ContractSchema = { root: { type: 'unknown' }, definitions: {} }
  return { source, schema, hash: hashContractSchema(schema), unavailableReason: reason }
}

/**
 * Marks `key` unavailable regardless of AST visit order or what else is already registered for
 * this route (an explicit marker, or an earlier implicit harvest) — a raw buffered body's shape
 * is never statically determinable, so it always wins. Mirrors the response side's
 * `markBufferedRouteUnavailable` for `ctx.response.buffer(...)`.
 */
export function markBufferedRequestRouteUnavailable(
  contracts: Map<string, BackendRequestContract>,
  key: string,
  binding: RouteBinding,
  source: string,
): void {
  contracts.set(key, {
    ...unavailableRequestContract(
      source,
      'route reads a raw buffered request body (ctx.request.buffer) whose shape is not statically determinable',
    ),
    ...binding,
  })
}

/**
 * Inserts `contract` at `key`, throwing if `key` already resolves to a different schema. Requests
 * have no `#variant` escape hatch, so — unlike the response side, where a genuine collision is
 * always a real author bug worth surfacing — callers here must choose deliberately whether a
 * mismatch should throw (an explicit marker collision) or be caught (an implicit harvest
 * collision); see `request-contract-implicit.mts`.
 */
export function registerRequestContract(
  contracts: Map<string, BackendRequestContract>,
  key: string,
  contract: BackendRequestContract,
): void {
  const existing = contracts.get(key)
  if (!existing) {
    contracts.set(key, contract)
    return
  }
  if (existing.hash !== contract.hash) {
    throw new Error(
      `Backend request contract "${key}" resolves to multiple backend request schemas at ${existing.source} and ${contract.source}`,
    )
  }
}

/**
 * Extracts a route's request contract and registers it. When `options.onRouteError` is set, an
 * extraction failure is caught, reported, and replaced with an `unavailable` placeholder instead
 * of aborting discovery for every other route — mirrors the response side's `registerRouteContract`.
 */
export function registerRequestRouteContract(
  contracts: Map<string, BackendRequestContract>,
  key: string,
  binding: RouteBinding,
  location: string,
  extract: () => ExtractedResponseContract,
  options: DiscoverApiRequestContractsOptions | undefined,
): void {
  let extracted: ExtractedResponseContract
  try {
    extracted = extract()
  } catch (error) {
    if (!options?.onRouteError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    options.onRouteError({
      method: binding.method,
      routeTemplate: binding.routeTemplate,
      source: location,
      reason,
    })
    extracted = unavailableRequestContract(location, reason)
  }
  registerRequestContract(contracts, key, { ...extracted, ...binding })
}
