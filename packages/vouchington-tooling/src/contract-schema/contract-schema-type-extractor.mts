import ts from './typescript-api.mts'

import { hashContractSchema } from '../openapi-document/contract-schema-canonical.mts'
import type {
  ContractSchema,
  ContractSchemaNode,
} from '../openapi-document/contract-schema-types.mts'
import { objectSchema, tupleSchema } from './contract-schema-object-tuple.mts'
import type { ExtractContractSchemaOptions, ExtractedResponseContract } from './types.mts'
import {
  assertNotClass,
  distinctNodes,
  jsonPromiseType,
  jsonSerializedType,
  namedObjectDefinition,
  unsupportedType,
} from './contract-schema-type-utils.mts'

export type ExtractionContext = {
  checker: ts.TypeChecker
  definitions: Map<string, ContractSchemaNode>
  definitionTypes: Map<string, ts.Type>
  activeTypes: Map<ts.Type, string>
  options: ExtractContractSchemaOptions
}

export function extractContractSchema(
  type: ts.Type,
  checker: ts.TypeChecker,
  source: string,
  options: ExtractContractSchemaOptions = {},
): ExtractedResponseContract {
  const definitions = new Map<string, ContractSchemaNode>()
  const context: ExtractionContext = {
    checker,
    definitions,
    definitionTypes: new Map(),
    activeTypes: new Map(),
    options,
  }
  let root: ContractSchemaNode
  try {
    root = schemaForType(type, context)
  } catch (error) {
    /* v8 ignore next -- schemaForType throws Error */
    if (!(error instanceof Error)) throw error
    throw new Error(`${source}: ${error.message}`, { cause: error })
  }
  const schema: ContractSchema = {
    root,
    definitions: Object.fromEntries(
      [...definitions.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  }
  return { source, schema, hash: hashContractSchema(schema) }
}

function schemaForType(type: ts.Type, context: ExtractionContext): ContractSchemaNode {
  const { checker, options } = context
  if (type.flags & ts.TypeFlags.Any) throw unsupportedType(type, checker, 'any is not allowed')
  if (type.flags & ts.TypeFlags.Unknown) return { type: 'unknown' }
  const formatAlias = type.aliasSymbol ? options.formatAliases?.[type.aliasSymbol.name] : undefined
  if (formatAlias) return { type: 'string', format: formatAlias }
  if (type.flags & ts.TypeFlags.Never)
    throw unsupportedType(type, checker, 'never is not supported')
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return {
      type: 'literal',
      value: (type as ts.Type & { intrinsicName: string }).intrinsicName === 'true',
    }
  }
  if (type.flags & ts.TypeFlags.StringLiteral) {
    return { type: 'literal', value: (type as ts.StringLiteralType).value }
  }
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    return { type: 'literal', value: (type as ts.NumberLiteralType).value }
  }
  if (type.flags & ts.TypeFlags.StringLike) return { type: 'string' }
  if (type.flags & ts.TypeFlags.NumberLike) return { type: 'number' }
  if (type.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' }
  if (type.isUnion()) {
    const variants = type.types.filter((variant) => !(variant.flags & ts.TypeFlags.Undefined))
    /* v8 ignore next */
    if (variants.length === 0)
      throw unsupportedType(type, checker, 'undefined-only types are not supported')
    if (variants.length === 1) return schemaForType(variants[0]!, context)
    if (
      variants.length === 2 &&
      variants.every((variant) => variant.flags & ts.TypeFlags.BooleanLiteral)
    ) {
      return { type: 'boolean' }
    }
    const buildUnion = (): ContractSchemaNode => ({
      type: 'union',
      variants: distinctNodes(variants.map((variant) => schemaForType(variant, context))),
    })
    const definitionName = type.aliasSymbol ? namedObjectDefinition(type, checker) : undefined
    if (definitionName) return schemaForNamedType(type, definitionName, context, buildUnion)
    return buildUnion()
  }
  if (type.isIntersection()) {
    return {
      type: 'intersection',
      variants: distinctNodes(type.types.map((variant) => schemaForType(variant, context))),
    }
  }
  /* v8 ignore next */
  if (!(type.flags & ts.TypeFlags.Object)) throw unsupportedType(type, checker, 'unsupported type')
  const serializedType = jsonSerializedType(type, checker)
  if (serializedType) return schemaForType(serializedType, context)
  const promisedType = jsonPromiseType(type, checker)
  if (promisedType) return schemaForType(promisedType, context)
  if (checker.isTupleType(type)) return tupleSchema(type as ts.TupleType, context, schemaForType)
  const constrainedArray = boundedArraySchema(type, context)
  if (constrainedArray) return constrainedArray
  if (checker.isArrayType(type) || checker.isArrayLikeType(type)) {
    const typeArguments = checker.getTypeArguments(type as ts.TypeReference)
    /* v8 ignore next */
    if (!typeArguments[0]) throw unsupportedType(type, checker, 'array element type is missing')
    return { type: 'array', items: schemaForType(typeArguments[0], context) }
  }
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
    throw unsupportedType(type, checker, 'callable types are not supported')
  }
  if (checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0) {
    throw unsupportedType(type, checker, 'constructable types are not supported')
  }
  assertNotClass(type, checker)
  const definitionName = namedObjectDefinition(type, checker)
  if (definitionName) {
    return schemaForNamedType(type, definitionName, context, () =>
      objectSchema(type, context, schemaForType),
    )
  }
  return objectSchema(type, context, schemaForType)
}

function boundedArraySchema(
  type: ts.Type,
  context: ExtractionContext,
): Extract<ContractSchemaNode, { type: 'array' }> | undefined {
  const alias = context.options.boundedArrayAlias
  if (!alias || type.aliasSymbol?.name !== alias) return undefined
  const [itemType, minItemsType, maxItemsType, uniqueItemsType] = type.aliasTypeArguments ?? []
  if (!itemType || !minItemsType || !maxItemsType || !uniqueItemsType) {
    throw unsupportedType(type, context.checker, `${alias} requires four type arguments`)
  }
  const minItems = numberLiteralValue(minItemsType, type, context.checker, alias)
  const maxItems = numberLiteralValue(maxItemsType, type, context.checker, alias)
  if (minItems < 0 || maxItems < minItems) {
    throw unsupportedType(type, context.checker, `${alias} has invalid item bounds`)
  }
  if (!(uniqueItemsType.flags & ts.TypeFlags.BooleanLiteral)) {
    throw unsupportedType(type, context.checker, `${alias} uniqueness must be literal`)
  }
  return {
    type: 'array',
    items: schemaForType(itemType, context),
    minItems,
    maxItems,
    uniqueItems: (uniqueItemsType as ts.Type & { intrinsicName: string }).intrinsicName === 'true',
  }
}

function numberLiteralValue(
  type: ts.Type,
  owner: ts.Type,
  checker: ts.TypeChecker,
  alias: string,
): number {
  if (!(type.flags & ts.TypeFlags.NumberLiteral)) {
    throw unsupportedType(owner, checker, `${alias} bounds must be numeric literals`)
  }
  return (type as ts.NumberLiteralType).value
}

function schemaForNamedType(
  type: ts.Type,
  name: string,
  context: ExtractionContext,
  build: () => ContractSchemaNode,
): ContractSchemaNode {
  const existingType = context.definitionTypes.get(name)
  /* v8 ignore start -- distinct checker types sharing a definition name */
  if (existingType && existingType !== type) {
    const flags = ts.TypeFormatFlags.NoTruncation
    const existingIdentity = context.checker.typeToString(existingType, undefined, flags)
    const incomingIdentity = context.checker.typeToString(type, undefined, flags)
    if (existingIdentity === incomingIdentity) return { type: 'ref', name }
    throw new Error(`Response contract schema definition name collision: "${name}"`)
  }
  /* v8 ignore stop */
  if (context.definitions.has(name) || context.activeTypes.has(type)) return { type: 'ref', name }
  context.definitionTypes.set(name, type)
  context.activeTypes.set(type, name)
  context.definitions.set(name, build())
  context.activeTypes.delete(type)
  return { type: 'ref', name }
}
