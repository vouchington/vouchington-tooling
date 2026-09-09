import type {
  ContractSchema,
  ContractSchemaNode,
} from '../openapi-document/contract-schema-types.mts'
import type { ContractValidationIssue } from './types.mts'
import {
  addIssue,
  addUnexpectedIssue,
  collectObjectShape,
  isObject,
  propertyPath,
  requireType,
  type ValidationContext,
} from './validation-helpers.mts'

export function validateResponseContract(
  schema: ContractSchema,
  value: unknown,
): ContractValidationIssue[] {
  const context: ValidationContext = { definitions: schema.definitions, issues: [] }
  validateNode(schema.root, value, '$', context, true)
  return context.issues
}

function validateNode(
  node: ContractSchemaNode,
  value: unknown,
  path: string,
  context: ValidationContext,
  checkUnexpected: boolean,
): void {
  switch (node.type) {
    case 'unknown':
      return
    case 'null':
      return requireType(value === null, 'null', value, path, context)
    case 'boolean':
      return requireType(typeof value === 'boolean', 'boolean', value, path, context)
    case 'number':
      return requireType(
        typeof value === 'number' && Number.isFinite(value),
        'number',
        value,
        path,
        context,
      )
    case 'string':
      return requireType(typeof value === 'string', 'string', value, path, context)
    case 'literal':
      return requireType(
        Object.is(value, node.value),
        JSON.stringify(node.value),
        value,
        path,
        context,
      )
    case 'array':
      return validateArray(node.items, value, path, context)
    case 'tuple':
      return validateTuple(node, value, path, context)
    case 'object':
      return validateObject(node, value, path, context, checkUnexpected)
    case 'union':
      return validateUnion(node.variants, value, path, context)
    case 'intersection':
      return validateIntersection(node.variants, value, path, context)
    case 'ref': {
      const definition = context.definitions[node.name]
      if (!definition) throw new Error(`Unknown response contract schema reference "${node.name}"`)
      return validateNode(definition, value, path, context, checkUnexpected)
    }
  }
}

function validateArray(
  itemSchema: ContractSchemaNode,
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  if (!Array.isArray(value)) return requireType(false, 'array', value, path, context)
  for (const item of value) validateNode(itemSchema, item, `${path}[*]`, context, true)
}

function validateTuple(
  node: Extract<ContractSchemaNode, { type: 'tuple' }>,
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  if (!Array.isArray(value)) return requireType(false, 'tuple', value, path, context)
  const requiredLength = node.items.length - node.optionalItems
  if (value.length < requiredLength) {
    addIssue(
      context,
      path,
      'type',
      `Expected at least ${requiredLength} tuple items, received ${value.length}`,
    )
  }
  if (!node.rest && value.length > node.items.length) {
    addIssue(
      context,
      path,
      'type',
      `Expected at most ${node.items.length} tuple items, received ${value.length}`,
    )
  }
  node.items.forEach((item, index) => {
    if (index < value.length) validateNode(item, value[index], `${path}[${index}]`, context, true)
  })
  if (node.rest) {
    for (const item of value.slice(node.items.length)) {
      validateNode(node.rest, item, `${path}[*]`, context, true)
    }
  }
}

function validateObject(
  node: Extract<ContractSchemaNode, { type: 'object' }>,
  value: unknown,
  path: string,
  context: ValidationContext,
  checkUnexpected: boolean,
): void {
  if (!isObject(value)) return requireType(false, 'object', value, path, context)

  for (const [key, property] of Object.entries(node.properties)) {
    if (!(key in value)) {
      if (property.required) {
        addIssue(context, propertyPath(path, key), 'missing-required', 'Required field is missing')
      }
      continue
    }
    validateNode(property.schema, value[key], propertyPath(path, key), context, true)
  }

  if (!checkUnexpected) return
  for (const [key, nested] of Object.entries(value)) {
    if (key in node.properties) continue
    if (node.additionalProperties === false) {
      addUnexpectedIssue(context, propertyPath(path, key))
      continue
    }
    validateNode(node.additionalProperties, nested, `${path}{*}`, context, true)
  }
}

function validateUnion(
  variants: ContractSchemaNode[],
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  const attempts = variants.map((variant) =>
    validateIsolated(variant, value, path, context.definitions),
  )
  if (attempts.some((issues) => issues.length === 0)) return
  const closest = attempts.toSorted((left, right) => left.length - right.length)[0]
  /* v8 ignore next -- unions always have at least one variant */
  if (closest) context.issues.push(...closest)
}

function validateIntersection(
  variants: ContractSchemaNode[],
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  for (const variant of variants) validateNode(variant, value, path, context, false)
  if (!isObject(value)) return

  const allowedProperties = new Set<string>()
  let additionalSchema: ContractSchemaNode | undefined
  const addAdditionalSchema = (schema: ContractSchemaNode) => {
    additionalSchema ??= schema
  }
  for (const variant of variants) {
    collectObjectShape(variant, context.definitions, allowedProperties, addAdditionalSchema)
  }
  for (const [key, nested] of Object.entries(value)) {
    if (allowedProperties.has(key)) continue
    if (additionalSchema) {
      validateNode(additionalSchema, nested, `${path}{*}`, context, true)
    } else {
      addUnexpectedIssue(context, propertyPath(path, key))
    }
  }
}

function validateIsolated(
  node: ContractSchemaNode,
  value: unknown,
  path: string,
  definitions: Record<string, ContractSchemaNode>,
): ContractValidationIssue[] {
  const isolated: ValidationContext = { definitions, issues: [] }
  validateNode(node, value, path, isolated, true)
  return isolated.issues
}
