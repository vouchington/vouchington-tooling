import type { ComponentRegistry } from './component-registry.mts'
import { nodeToOpenApi } from './contract-schema-to-openapi.mts'
import type { RequestContract } from './operation-types.mts'
import type { OpenApiRequestBody, OpenApiSchema } from './openapi-types.mts'

export function buildOperationRequestBody(
  contract: RequestContract | undefined,
  registry: ComponentRegistry,
): { requestBody: OpenApiRequestBody | undefined; unavailable: boolean } {
  if (!contract) return { requestBody: undefined, unavailable: false }

  if (contract.unavailableReason) {
    return { unavailable: true, requestBody: unavailableRequestBody(contract.unavailableReason) }
  }

  let schema: OpenApiSchema
  try {
    schema = nodeToOpenApi(contract.schema.root, {
      definitions: contract.schema.definitions,
      refName: registry.refName,
    })
  } catch (error) {
    /* v8 ignore next -- thrown values are Errors from nodeToOpenApi */
    const reason = error instanceof Error ? error.message : String(error)
    return { unavailable: true, requestBody: unavailableRequestBody(reason) }
  }

  registry.register(contract.source, contract.schema.definitions)
  return { unavailable: false, requestBody: { content: { 'application/json': { schema } } } }
}

function unavailableRequestBody(reason: string): OpenApiRequestBody {
  return {
    content: { 'application/json': { schema: {} } },
    'x-request-schema-unavailable': true,
    'x-request-schema-unavailable-reason': reason,
  }
}
