import type { ComponentRegistry } from './component-registry.mts'
import { nodeToOpenApi } from './contract-schema-to-openapi.mts'
import type { ResponseContract } from './operation-types.mts'
import type { OpenApiSchema } from './openapi-types.mts'

export type SseEventSchemas = Map<string, OpenApiSchema[]>

export function collectSseEventSchemas(
  contract: ResponseContract,
  registry: ComponentRegistry,
): { schemas: SseEventSchemas; failureReasons: string[] } {
  const schemas: SseEventSchemas = new Map()
  const failureReasons: string[] = []
  if (contract.mediaType !== 'text/event-stream' && !contract.sseEvents)
    return { schemas, failureReasons }
  if (contract.mediaType !== 'text/event-stream' || contract.bodyKind === 'none')
    return {
      schemas,
      failureReasons: ['SSE event metadata requires a text/event-stream response body'],
    }
  if (!contract.sseEvents?.length)
    return { schemas, failureReasons: ['SSE event payload contracts are missing'] }

  for (const { eventName, contract: event } of contract.sseEvents) {
    if (!eventName.trim() || event.schema.root.type === 'unknown') {
      failureReasons.push('SSE event payload or name is not statically known')
      continue
    }
    let schema: OpenApiSchema
    try {
      schema = nodeToOpenApi(event.schema.root, {
        definitions: event.schema.definitions,
        refName: registry.refName,
      })
    } catch (error) {
      failureReasons.push(String(error))
      continue
    }
    registry.register(event.source, event.schema.definitions)
    const variants = schemas.get(eventName) ?? []
    variants.push(schema)
    schemas.set(eventName, variants)
  }
  return { schemas, failureReasons }
}

export function renderSseEvents(
  schemas: SseEventSchemas,
): Record<string, { dataSchema: OpenApiSchema }> {
  return Object.fromEntries(
    [...schemas.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, variants]) => {
        const unique = [
          ...new Map(variants.map((schema) => [JSON.stringify(schema), schema])).values(),
        ].toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
        return [name, { dataSchema: unique.length === 1 ? unique[0]! : { anyOf: unique } }]
      }),
  )
}
