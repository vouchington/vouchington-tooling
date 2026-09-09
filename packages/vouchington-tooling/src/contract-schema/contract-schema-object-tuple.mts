import ts from './typescript-api.mts'

import type { ContractSchemaNode } from '../openapi-document/contract-schema-types.mts'
import type { ExtractionContext } from './contract-schema-type-extractor.mts'
import { compareSymbols } from './contract-schema-type-utils.mts'

// `schemaForType` is passed in (rather than imported) so this module doesn't form an import
// cycle with the dispatcher in contract-schema-type-extractor.mts, which calls back into these
// functions for `object`/`tuple` types.
type SchemaForType = (type: ts.Type, context: ExtractionContext) => ContractSchemaNode

export function objectSchema(
  type: ts.Type,
  context: ExtractionContext,
  schemaForType: SchemaForType,
): ContractSchemaNode {
  const properties: Record<string, { required: boolean; schema: ContractSchemaNode }> = {}
  for (const property of context.checker.getPropertiesOfType(type).toSorted(compareSymbols)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0]
    /* v8 ignore start */
    const propertyType = declaration
      ? context.checker.getTypeOfSymbolAtLocation(property, declaration)
      : typeOfSyntheticProperty(property, context.checker)
    if (!propertyType) throw new Error(`Property "${property.name}" has no type`)
    /* v8 ignore stop */
    try {
      properties[property.name] = {
        required: !(property.flags & ts.SymbolFlags.Optional),
        schema: schemaForType(propertyType, context),
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Property "${property.name}": ${error.message}`, { cause: error })
      }
      /* v8 ignore next -- schemaForType throws Error */
      throw error
    }
  }
  const stringIndex = context.checker.getIndexInfoOfType(type, ts.IndexKind.String)
  return {
    type: 'object',
    properties,
    additionalProperties: stringIndex ? schemaForType(stringIndex.type, context) : false,
  }
}

/* v8 ignore start -- checker internal used only for compiler-synthesized properties */
function typeOfSyntheticProperty(
  property: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Type | undefined {
  return (
    checker as ts.TypeChecker & {
      getTypeOfSymbol?: (symbol: ts.Symbol) => ts.Type
    }
  ).getTypeOfSymbol?.(property)
}
/* v8 ignore stop */

export function tupleSchema(
  type: ts.TupleType,
  context: ExtractionContext,
  schemaForType: SchemaForType,
): ContractSchemaNode {
  const items = context.checker.getTypeArguments(type as ts.TypeReference)
  const flags =
    ((type as ts.TypeReference).target as ts.TupleType).elementFlags ?? /* v8 ignore next */ []
  const restIndex = flags.findIndex((flag) => Boolean(flag & ts.ElementFlags.Variable))
  const fixedItems = restIndex === -1 ? items : items.slice(0, restIndex)
  return {
    type: 'tuple',
    items: fixedItems.map((item) => schemaForType(item, context)),
    optionalItems: flags
      .slice(0, fixedItems.length)
      .filter((flag) => Boolean(flag & ts.ElementFlags.Optional)).length,
    ...(restIndex === -1 ? {} : { rest: schemaForType(items[restIndex]!, context) }),
  }
}
