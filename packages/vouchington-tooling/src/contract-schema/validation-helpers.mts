import type { ContractSchemaNode } from '../openapi-document/contract-schema-types.mts'
import type { ContractValidationIssue } from './types.mts'

export type ValidationContext = {
  definitions: Record<string, ContractSchemaNode>
  issues: ContractValidationIssue[]
}

export function requireType(
  valid: boolean,
  expected: string,
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  if (valid) return
  addIssue(context, path, 'type', `Expected ${expected}, received ${describeValue(value)}`)
}

export function addIssue(
  context: ValidationContext,
  path: string,
  kind: ContractValidationIssue['kind'],
  message: string,
): void {
  context.issues.push({ path, kind, message })
}

export function addUnexpectedIssue(context: ValidationContext, path: string): void {
  addIssue(context, path, 'unexpected', 'Field is not declared by the contract')
}

export function propertyPath(path: string, property: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(property)
    ? `${path}.${property}`
    : `${path}[${JSON.stringify(property)}]`
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function collectObjectShape(
  node: ContractSchemaNode,
  definitions: Record<string, ContractSchemaNode>,
  properties: Set<string>,
  addAdditional: (schema: ContractSchemaNode) => void,
): void {
  if (node.type === 'ref') {
    const definition = definitions[node.name]
    if (definition) collectObjectShape(definition, definitions, properties, addAdditional)
    return
  }
  if (node.type === 'intersection') {
    for (const variant of node.variants) {
      collectObjectShape(variant, definitions, properties, addAdditional)
    }
    return
  }
  if (node.type !== 'object') return
  Object.keys(node.properties).forEach((key) => properties.add(key))
  if (node.additionalProperties !== false) addAdditional(node.additionalProperties)
}
