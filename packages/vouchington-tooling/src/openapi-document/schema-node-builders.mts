import type { ContractSchemaNode, ContractSchemaProperty } from './contract-schema-types.mts'

export function objectNode(
  properties: Record<string, ContractSchemaProperty> = {},
): ContractSchemaNode {
  return { type: 'object', properties, additionalProperties: false }
}

export function requiredProperty(
  schema: ContractSchemaNode,
  required = true,
): ContractSchemaProperty {
  return { required, schema }
}
