import { createHash } from 'node:crypto'

import type { ContractSchema, ContractSchemaNode } from './contract-schema-types.mts'

export function canonicalContractSchema(schema: ContractSchema): string {
  return JSON.stringify(sortSchemaValue(schema))
}

export function hashContractSchema(schema: ContractSchema): string {
  return createHash('sha256').update(canonicalContractSchema(schema)).digest('hex')
}

function sortSchemaValue(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const sorted = value.map((item) => sortSchemaValue(item))
    return parentKey === 'variants'
      ? sorted.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : sorted
  }
  if (value == null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortSchemaValue(nested, key)]),
  )
}

export function canonicalContractSchemaNode(node: ContractSchemaNode): string {
  return JSON.stringify(sortSchemaValue(node))
}
