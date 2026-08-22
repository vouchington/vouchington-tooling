import { intersectionToOpenApi } from './contract-schema-intersection-merge.mts'
import type { ContractSchemaNode } from './contract-schema-types.mts'
import type { OpenApiSchema } from './openapi-types.mts'

export type OpenApiConverterContext = {
  definitions: Record<string, ContractSchemaNode>
  refName: (name: string) => string
}

export function nodeToOpenApi(
  node: ContractSchemaNode,
  ctx: OpenApiConverterContext,
): OpenApiSchema {
  switch (node.type) {
    case 'unknown':
      return {}
    case 'null':
      return { type: 'null' }
    case 'boolean':
    case 'number':
      return { type: node.type }
    case 'string':
      return { type: node.type, ...(node.format === undefined ? {} : { format: node.format }) }
    case 'literal':
      return { const: node.value }
    case 'array':
      return {
        type: 'array',
        items: nodeToOpenApi(node.items, ctx),
        ...(node.minItems === undefined ? {} : { minItems: node.minItems }),
        ...(node.maxItems === undefined ? {} : { maxItems: node.maxItems }),
        ...(node.uniqueItems === undefined ? {} : { uniqueItems: node.uniqueItems }),
      }
    case 'tuple':
      return tupleToOpenApi(node, ctx)
    case 'object':
      return objectToOpenApi(node, ctx)
    case 'union':
      return unionToOpenApi(node, ctx)
    case 'intersection':
      return intersectionToOpenApi(node, ctx, nodeToOpenApi)
    case 'ref':
      return { $ref: `#/components/schemas/${ctx.refName(node.name)}` }
  }
}

function tupleToOpenApi(
  node: Extract<ContractSchemaNode, { type: 'tuple' }>,
  ctx: OpenApiConverterContext,
): OpenApiSchema {
  const prefixItems = node.items.map((item) => nodeToOpenApi(item, ctx))
  const minItems = node.items.length - node.optionalItems
  if (node.rest) {
    return { type: 'array', prefixItems, minItems, items: nodeToOpenApi(node.rest, ctx) }
  }
  return { type: 'array', prefixItems, minItems, items: false, maxItems: node.items.length }
}

function objectToOpenApi(
  node: Extract<ContractSchemaNode, { type: 'object' }>,
  ctx: OpenApiConverterContext,
): OpenApiSchema {
  const keys = Object.keys(node.properties).toSorted()
  const properties: Record<string, OpenApiSchema> = {}
  const required: string[] = []
  for (const key of keys) {
    const property = node.properties[key]!
    properties[key] = nodeToOpenApi(property.schema, ctx)
    if (property.required) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties:
      node.additionalProperties === false ? false : nodeToOpenApi(node.additionalProperties, ctx),
  }
}

const LITERAL_TYPES = { boolean: 'boolean', number: 'number', string: 'string' } as const

function unionToOpenApi(
  node: Extract<ContractSchemaNode, { type: 'union' }>,
  ctx: OpenApiConverterContext,
): OpenApiSchema {
  return (
    literalUnionEnum(node) ?? { anyOf: node.variants.map((variant) => nodeToOpenApi(variant, ctx)) }
  )
}

function literalUnionEnum(
  node: Extract<ContractSchemaNode, { type: 'union' }>,
): OpenApiSchema | undefined {
  if (node.variants.length === 0) return undefined
  if (!node.variants.every((variant) => variant.type === 'literal')) return undefined
  const literals = node.variants as Extract<ContractSchemaNode, { type: 'literal' }>[]
  const type = LITERAL_TYPES[typeof literals[0]!.value as keyof typeof LITERAL_TYPES]
  const sameType = literals.every(
    (literal) => LITERAL_TYPES[typeof literal.value as keyof typeof LITERAL_TYPES] === type,
  )
  if (!sameType) return undefined
  const values = [...new Set(literals.map((literal) => literal.value))].toSorted((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )
  if (type === 'boolean' && values.length === 2) return { type: 'boolean' }
  return { type, enum: values }
}
