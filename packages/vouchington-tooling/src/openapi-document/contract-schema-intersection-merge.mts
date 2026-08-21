import { hashContractSchema } from './contract-schema-canonical.mts'
import type { ContractSchemaNode } from './contract-schema-types.mts'
import type { OpenApiConverterContext } from './contract-schema-to-openapi.mts'
import type { OpenApiSchema } from './openapi-types.mts'

/**
 * Structurally merges an all-object intersection instead of emitting raw `allOf`: the
 * extractor defaults `additionalProperties:false`, so `allOf` of two closed objects is
 * unsatisfiable. Falls back to raw `allOf` only when a member isn't an object (directly or
 * via `ref`), where that unsatisfiability concern doesn't apply. `nodeToOpenApi` is passed in
 * (rather than imported) so this module doesn't form an import cycle with the dispatcher.
 */
export function intersectionToOpenApi(
  node: Extract<ContractSchemaNode, { type: 'intersection' }>,
  ctx: OpenApiConverterContext,
  nodeToOpenApi: (node: ContractSchemaNode, ctx: OpenApiConverterContext) => OpenApiSchema,
): OpenApiSchema {
  const resolved = node.variants.map((variant) => resolveObjectVariant(variant, ctx.definitions))
  if (resolved.some((variant) => variant === undefined)) {
    return { allOf: node.variants.map((variant) => nodeToOpenApi(variant, ctx)) }
  }

  const properties: Record<string, { schema: ContractSchemaNode; required: boolean }> = {}
  for (const variant of resolved) {
    for (const [key, property] of Object.entries(variant!.properties)) {
      const existing = properties[key]
      if (
        existing &&
        hashSchemaNode(existing.schema, ctx) !== hashSchemaNode(property.schema, ctx)
      ) {
        // A member re-declaring a shared key with a strictly narrower type is a common, valid
        // TypeScript intersection idiom (e.g. `Omit`-free overriding of an optional/nullable
        // field to a guaranteed-present one) — TypeScript itself resolves the property to the
        // narrower type, not a conflict. Prefer whichever side is the narrower one; only two
        // genuinely incompatible schemas (neither a subset of the other) are a real conflict.
        if (isNarrowerVariant(property.schema, existing.schema, ctx)) {
          properties[key] = {
            schema: property.schema,
            required: existing.required || property.required,
          }
          continue
        }
        /* v8 ignore next 6 -- symmetric of the previous branch; covered by order-swapped fixtures */
        if (isNarrowerVariant(existing.schema, property.schema, ctx)) {
          properties[key] = {
            schema: existing.schema,
            required: existing.required || property.required,
          }
          continue
        }
        throw new Error(
          `Cannot merge intersection: property "${key}" has conflicting schemas across members`,
        )
      }
      properties[key] = {
        schema: property.schema,
        required: existing?.required || property.required,
      }
    }
  }

  const sortedKeys = Object.keys(properties).toSorted()
  const required = sortedKeys.filter((key) => properties[key]!.required)
  return {
    type: 'object',
    properties: Object.fromEntries(
      sortedKeys.map((key) => [key, nodeToOpenApi(properties[key]!.schema, ctx)]),
    ),
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

// Bounds intersection-merge ref resolution so a cyclic or pathologically deep `definitions`
// chain can't hang the converter; falls back to raw `allOf` if the object is still unresolved
// past this many hops (comfortably above the extractor's actual definition-nesting depths).
const MAX_REF_RESOLUTION_HOPS = 5

function resolveObjectVariant(
  node: ContractSchemaNode,
  definitions: Record<string, ContractSchemaNode>,
): Extract<ContractSchemaNode, { type: 'object' }> | undefined {
  const resolved = resolveRef(node, definitions)
  return resolved.type === 'object' ? resolved : undefined
}

/** Follows a `ref` chain (bounded by `MAX_REF_RESOLUTION_HOPS`) to its underlying node, whatever shape that turns out to be. Returns the node unchanged if it isn't a `ref`, or if the chain doesn't resolve within the hop budget. */
function resolveRef(
  node: ContractSchemaNode,
  definitions: Record<string, ContractSchemaNode>,
): ContractSchemaNode {
  let current = node
  for (let hop = 0; hop < MAX_REF_RESOLUTION_HOPS && current.type === 'ref'; hop++) {
    const next: ContractSchemaNode | undefined = definitions[current.name]
    if (!next) return current
    current = next
  }
  return current
}

function hashSchemaNode(node: ContractSchemaNode, ctx: OpenApiConverterContext): string {
  return hashContractSchema({ root: node, definitions: ctx.definitions })
}

/**
 * True when every value `narrow` accepts is also accepted by `wide` — i.e. `narrow`'s own variant
 * set (a non-union schema is its own single-variant set) is a subset of `wide`'s. Covers the
 * realistic case this converter needs to handle (an intersection member narrowing a shared
 * optional/nullable property to a guaranteed-present one, e.g. `string | null` narrowed to
 * `string`) without attempting full structural subtyping for arbitrary object shapes.
 *
 * Both sides are `ref`-resolved first: a shared property declared with its own named union alias
 * (e.g. `post_type: PostType`) extracts as a `ref` to that alias, not an inline `union` node, so
 * checking `.type === 'union'` on the raw node would miss it entirely.
 */
function isNarrowerVariant(
  narrow: ContractSchemaNode,
  wide: ContractSchemaNode,
  ctx: OpenApiConverterContext,
): boolean {
  const resolvedNarrow = resolveRef(narrow, ctx.definitions)
  const resolvedWide = resolveRef(wide, ctx.definitions)
  const narrowVariants =
    resolvedNarrow.type === 'union' ? resolvedNarrow.variants : [resolvedNarrow]
  const wideHashes = new Set(
    (resolvedWide.type === 'union' ? resolvedWide.variants : [resolvedWide]).map((variant) =>
      hashSchemaNode(variant, ctx),
    ),
  )
  return narrowVariants.every((variant) => wideHashes.has(hashSchemaNode(variant, ctx)))
}
