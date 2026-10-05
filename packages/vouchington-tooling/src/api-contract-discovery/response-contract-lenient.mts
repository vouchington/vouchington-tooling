import { hashContractSchema } from '../contract-schema/index.mts'
import type {
  ContractSchema,
  ExtractedResponseContract,
  ExtractContractSchemaOptions,
} from '../contract-schema/index.mts'
import { registerContract } from './response-contract-registration.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'
import type { BackendResponseContract } from './response-contract-types.mts'

export type RouteDiscoveryError = {
  method: string
  routeTemplate: string
  source: string
  reason: string
}

/**
 * A response emitter found in a named handler registered for multiple routes. `sourceLocation`
 * is a normalized source path followed by one-based line and column; `routes` contains unique,
 * lexically sorted `METHOD:path` keys. `label` identifies the implicit response form.
 */
export type AmbiguousAttributionFact = {
  sourceLocation: string
  label: string
  routes: readonly string[]
}

export type DiscoverApiResponseContractsOptions = ExtractContractSchemaOptions & {
  onRouteError?: (error: RouteDiscoveryError) => void
  /**
   * Opt in to response-attribution facts from the existing discovery pass. Facts are delivered
   * after discovery succeeds, ordered by normalized source location; each callback receives its
   * own copy of the sorted route list. Dynamic error payloads paired with a non-literal status are
   * excluded from these facts; discovery output keeps its existing behavior. Consumers choose
   * whether a fact needs a diagnostic or policy.
   */
  onAmbiguousAttribution?: (fact: AmbiguousAttributionFact) => void
}

/** Placeholder contract for a route whose response type could not be extracted. */
function unavailableContract(
  source: string,
  reason: string,
): ExtractedResponseContract & { unavailableReason: string } {
  const schema: ContractSchema = { root: { type: 'unknown' }, definitions: {} }
  return { source, schema, hash: hashContractSchema(schema), unavailableReason: reason }
}

/** Marks `key` unavailable regardless of AST visit order, for a route that can send a raw buffered body (e.g. a proxied MCP response) alongside a no-content branch. */
export function markBufferedRouteUnavailable(
  contracts: Map<string, BackendResponseContract>,
  key: string,
  binding: RouteBinding,
  source: string,
): void {
  contracts.set(key, {
    ...unavailableContract(
      source,
      'route can send a raw buffered response body (ctx.response.buffer) whose shape is not statically determinable',
    ),
    ...binding,
    bodyKind: 'content',
    statusKnowledge: 'unknown',
    mediaTypeKnowledge: 'unknown',
  })
}

/**
 * Extracts a route's response contract and registers it. When `options.onRouteError` is
 * set, an extraction failure is caught, reported, and replaced with an `unavailable`
 * placeholder instead of aborting discovery for every other route. With `options` absent
 * (or `onRouteError` unset), behavior is unchanged: extraction failures throw.
 */
export function registerRouteContract(
  contracts: Map<string, BackendResponseContract>,
  key: string,
  binding: RouteBinding,
  location: string,
  emission: Pick<
    BackendResponseContract,
    'bodyKind' | 'mediaType' | 'mediaTypeKnowledge' | 'statusCodes' | 'statusKnowledge'
  > & {
    unavailableReason?: string
  },
  extract: () => ExtractedResponseContract,
  options: DiscoverApiResponseContractsOptions | undefined,
): void {
  let extracted: ExtractedResponseContract
  try {
    if (emission.unavailableReason) throw new Error(emission.unavailableReason)
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
    extracted = unavailableContract(location, reason)
  }
  registerContract(contracts, key, {
    ...extracted,
    ...binding,
    ...(emission.bodyKind ? { bodyKind: emission.bodyKind } : {}),
    ...(emission.mediaType ? { mediaType: emission.mediaType } : {}),
    ...(emission.mediaTypeKnowledge ? { mediaTypeKnowledge: emission.mediaTypeKnowledge } : {}),
    ...(emission.statusCodes ? { statusCodes: emission.statusCodes } : {}),
    ...(emission.statusKnowledge ? { statusKnowledge: emission.statusKnowledge } : {}),
  })
}
