import type { OpenApiParameter, OpenApiSchema } from './openapi-types.mts'
import type { OpenApiQueryContract, OpenApiQueryParameter } from './query-types.mts'

export function queryParameters(contract: OpenApiQueryContract | undefined): OpenApiParameter[] {
  if (!contract) return []
  return Object.entries(contract)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, descriptor]) => queryParameter(name, descriptor))
}

function queryParameter(name: string, descriptor: OpenApiQueryParameter): OpenApiParameter {
  return {
    name,
    in: 'query',
    required: false,
    ...(descriptor.description ? { description: descriptor.description } : {}),
    ...(descriptor.kind === 'csv-array'
      ? { style: descriptor.style, explode: descriptor.explode }
      : {}),
    schema: querySchema(descriptor),
  }
}

function querySchema(descriptor: OpenApiQueryParameter): OpenApiSchema {
  switch (descriptor.kind) {
    case 'string':
      return { type: 'string', ...(descriptor.format ? { format: descriptor.format } : {}) }
    case 'uuid-or-uri':
      return {
        anyOf: [
          { type: 'string', format: 'uuid' },
          { type: 'string', format: 'uri' },
        ],
      }
    case 'boolean':
      return { type: 'boolean' }
    case 'nullable-boolean':
      return { anyOf: [{ type: 'boolean' }, { type: 'string', const: 'null' }] }
    case 'number':
      return { type: 'number' }
    case 'integer':
      return {
        type: 'integer',
        minimum: descriptor.minimum,
        maximum: descriptor.maximum,
        ...(descriptor.default === undefined ? {} : { default: descriptor.default }),
      }
    case 'enum':
      return {
        type: 'string',
        enum: [...descriptor.values],
        ...(descriptor.default === undefined ? {} : { default: descriptor.default }),
      }
    case 'csv-array':
      return { type: 'array', items: querySchema(descriptor.items) }
  }
}
