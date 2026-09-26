import ts from './typescript-api.mts'

import type { ContractSchemaNode } from '../openapi-document/contract-schema-types.mts'
import { unsupportedType } from './contract-schema-type-utils.mts'
import type { ExtractContractSchemaOptions } from './types.mts'

export type ExtractionContext = {
  checker: ts.TypeChecker
  definitions: Map<string, ContractSchemaNode>
  definitionTypes: Map<string, ts.Type>
  activeTypes: Map<ts.Type, string>
  options: ExtractContractSchemaOptions
}

// `schemaForType` is passed in (rather than imported) so this module does not import
// the dispatcher in contract-schema-type-extractor.mts, which calls back for bounded arrays.
type SchemaForType = (type: ts.Type, context: ExtractionContext) => ContractSchemaNode

export function boundedArraySchema(
  type: ts.Type,
  context: ExtractionContext,
  schemaForType: SchemaForType,
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
