import { STATUS_CODES } from 'node:http'

import type { ComponentRegistry } from './component-registry.mts'
import { nodeToOpenApi } from './contract-schema-to-openapi.mts'
import { responseStatusCodesForContract, type ResponseContract } from './operation-types.mts'
import type { OpenApiResponse, OpenApiResponseOrRef, OpenApiSchema } from './openapi-types.mts'

type ResponseBucket = {
  schemas: OpenApiSchema[]
  failureReasons: string[]
}

export function buildOperationResponse(
  variants: ResponseContract[],
  registry: ComponentRegistry,
): {
  responses: Record<number, OpenApiResponseOrRef>
  unavailable: boolean
  unavailableReason?: string
} {
  const content = new Map<number, Map<string, ResponseBucket>>()
  const bodyless = new Map<number, string[]>()
  const operationFailures: string[] = []

  for (const contract of variants) {
    const converted = convertContract(contract, registry)
    if (converted.failureReason) operationFailures.push(converted.failureReason)
    if (contract.statusKnowledge === 'unknown' && !converted.failureReason)
      operationFailures.push('response status is not statically known')
    for (const status of responseStatusCodesForContract(contract)) {
      if (bodyKindFor(contract) === 'none') {
        const reasons = bodyless.get(status) ?? []
        if (converted.failureReason) reasons.push(converted.failureReason)
        bodyless.set(status, reasons)
        continue
      }
      const mediaType = mediaTypeFor(contract)
      if (!mediaType) {
        operationFailures.push('response media type is not statically known')
        continue
      }
      const byMedia = content.get(status) ?? new Map<string, ResponseBucket>()
      const bucket = byMedia.get(mediaType) ?? { schemas: [], failureReasons: [] }
      bucket.schemas.push(converted.schema ?? {})
      if (converted.failureReason) bucket.failureReasons.push(converted.failureReason)
      byMedia.set(mediaType, bucket)
      content.set(status, byMedia)
    }
  }

  const responses: Record<number, OpenApiResponse> = {}
  const statuses = new Set([...bodyless.keys(), ...content.keys()])
  for (const status of [...statuses].toSorted((left, right) => left - right)) {
    responses[status] = renderStatusResponse(
      status,
      content.get(status),
      bodyless,
      operationFailures,
    )
  }

  const reasons = [...new Set(operationFailures)]
  return {
    responses,
    unavailable: reasons.length > 0,
    ...(reasons.length > 0 ? { unavailableReason: reasons.join('; ') } : {}),
  }
}

function renderStatusResponse(
  status: number,
  byMedia: Map<string, ResponseBucket> | undefined,
  bodyless: Map<number, string[]>,
  operationFailures: string[],
): OpenApiResponse {
  const hasBodyless = bodyless.has(status)
  const conflictReason =
    byMedia && hasBodyless
      ? `status ${status} has both body and no-body variants`
      : byMedia && (status === 204 || status === 205)
        ? `status ${status} cannot carry a response body`
        : undefined
  if (conflictReason) operationFailures.push(conflictReason)

  const bucketFailures = [
    ...(bodyless.get(status) ?? []),
    ...[...(byMedia?.values() ?? [])].flatMap((bucket) => bucket.failureReasons),
    ...(conflictReason ? [conflictReason] : []),
  ]
  return {
    description: STATUS_CODES[status] ?? 'Response',
    ...(!conflictReason && byMedia
      ? {
          content: Object.fromEntries(
            [...byMedia.entries()]
              .toSorted(([left], [right]) => left.localeCompare(right))
              .map(([mediaType, bucket]) => [
                mediaType,
                { schema: mergeVariantSchemas(bucket.schemas) },
              ]),
          ),
        }
      : {}),
    ...(bucketFailures.length > 0
      ? {
          'x-schema-unavailable': true as const,
          'x-schema-unavailable-reason': [...new Set(bucketFailures)].join('; '),
        }
      : {}),
  }
}

function convertContract(
  contract: ResponseContract,
  registry: ComponentRegistry,
): { schema?: OpenApiSchema; failureReason?: string } {
  if (contract.unavailableReason) return { failureReason: contract.unavailableReason }
  let schema: OpenApiSchema
  try {
    schema = nodeToOpenApi(contract.schema.root, {
      definitions: contract.schema.definitions,
      refName: registry.refName,
    })
  } catch (error) {
    /* v8 ignore start */
    return { failureReason: error instanceof Error ? error.message : String(error) }
    /* v8 ignore stop */
  }
  registry.register(contract.source, contract.schema.definitions)
  return { schema }
}

function mediaTypeFor(contract: ResponseContract): string | undefined {
  if (contract.mediaTypeKnowledge === 'unknown') return undefined
  return contract.mediaType ?? 'application/json'
}

function bodyKindFor(contract: ResponseContract): 'content' | 'none' {
  return contract.bodyKind ?? (contract.schema.root.type === 'null' ? 'none' : 'content')
}

export function mergeVariantSchemas(schemas: OpenApiSchema[]): OpenApiSchema {
  const unique = [...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values()]
  return unique.length === 1 ? unique[0]! : { anyOf: unique }
}
