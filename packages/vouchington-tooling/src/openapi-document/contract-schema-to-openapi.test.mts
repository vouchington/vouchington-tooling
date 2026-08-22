import { describe, expect, it } from 'vitest'

import type { ContractSchemaNode } from './contract-schema-types.mts'
import { nodeToOpenApi, type OpenApiConverterContext } from './contract-schema-to-openapi.mts'
import { objectNode as obj, requiredProperty as prop } from './schema-node-builders.mts'

const noRefsCtx: OpenApiConverterContext = { definitions: {}, refName: (name) => name }

function convert(node: ContractSchemaNode, definitions: Record<string, ContractSchemaNode> = {}) {
  return nodeToOpenApi(node, { definitions, refName: (name) => `Sanitized${name}` })
}

describe('nodeToOpenApi', () => {
  it('converts scalar and literal nodes', () => {
    expect(convert({ type: 'unknown' })).toEqual({})
    expect(convert({ type: 'null' })).toEqual({ type: 'null' })
    expect(convert({ type: 'boolean' })).toEqual({ type: 'boolean' })
    expect(convert({ type: 'number' })).toEqual({ type: 'number' })
    expect(convert({ type: 'string' })).toEqual({ type: 'string' })
    expect(convert({ type: 'literal', value: 'active' })).toEqual({ const: 'active' })
  })

  it('projects UUID formats and array constraints through nested schemas', () => {
    expect(
      convert(
        obj({
          resources: prop({
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 3,
            uniqueItems: true,
          }),
          id: prop({ type: 'string', format: 'uuid' }),
        }),
      ),
    ).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        resources: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
        },
      },
      required: ['id', 'resources'],
      additionalProperties: false,
    })
  })

  it('converts array items and a ref via the sanitized name map', () => {
    expect(convert({ type: 'array', items: { type: 'string' } })).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
    expect(convert({ type: 'ref', name: 'Widget' })).toEqual({
      $ref: '#/components/schemas/SanitizedWidget',
    })
  })

  it('sets maxItems for a closed tuple but omits it when a rest element is present', () => {
    expect(
      convert({
        type: 'tuple',
        items: [{ type: 'string' }, { type: 'number' }],
        optionalItems: 1,
      }),
    ).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 1,
      items: false,
      maxItems: 2,
    })

    expect(
      convert({
        type: 'tuple',
        items: [{ type: 'string' }],
        optionalItems: 0,
        rest: { type: 'number' },
      }),
    ).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }],
      minItems: 1,
      items: { type: 'number' },
    })
  })

  it('converts an object, sorting properties and omitting required when empty', () => {
    expect(
      convert(obj({ b: prop({ type: 'string' }, false), a: prop({ type: 'number' }) })),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    })

    expect(
      convert({
        type: 'object',
        properties: { a: prop({ type: 'string' }, false) },
        additionalProperties: { type: 'unknown' },
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: {},
    })
  })

  it('collapses a same-primitive literal union to a sorted enum', () => {
    expect(
      convert({
        type: 'union',
        variants: [
          { type: 'literal', value: 'weekly' },
          { type: 'literal', value: 'daily' },
        ],
      }),
    ).toEqual({ type: 'string', enum: ['daily', 'weekly'] })
  })

  it('collapses a full boolean-domain literal union to a bare boolean type', () => {
    expect(
      convert({
        type: 'union',
        variants: [
          { type: 'literal', value: true },
          { type: 'literal', value: false },
        ],
      }),
    ).toEqual({ type: 'boolean' })
  })

  it('keeps enum for a partial-domain boolean literal union', () => {
    expect(convert({ type: 'union', variants: [{ type: 'literal', value: true }] })).toEqual({
      type: 'boolean',
      enum: [true],
    })
  })

  it('falls back to an empty anyOf for a variant-less union', () => {
    expect(convert({ type: 'union', variants: [] })).toEqual({ anyOf: [] })
  })

  it('falls back to anyOf for non-literal or mixed-primitive unions', () => {
    expect(convert({ type: 'union', variants: [{ type: 'null' }, { type: 'string' }] })).toEqual({
      anyOf: [{ type: 'null' }, { type: 'string' }],
    })

    expect(
      convert({
        type: 'union',
        variants: [
          { type: 'literal', value: 'one' },
          { type: 'literal', value: 1 },
        ],
      }),
    ).toEqual({ anyOf: [{ const: 'one' }, { const: 1 }] })
  })

  it('structurally merges an all-object intersection: unions properties, ORs required', () => {
    const node: ContractSchemaNode = {
      type: 'intersection',
      variants: [
        obj({ id: prop({ type: 'string' }) }),
        obj({ id: prop({ type: 'string' }, false), name: prop({ type: 'string' }) }),
      ],
    }
    expect(convert(node)).toEqual({
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      additionalProperties: false,
    })
  })

  it('resolves ref variants against the contract definitions map when merging', () => {
    const definitions: Record<string, ContractSchemaNode> = {
      Base: obj({ id: prop({ type: 'string' }) }),
    }
    const node: ContractSchemaNode = {
      type: 'intersection',
      variants: [{ type: 'ref', name: 'Base' }, obj({ name: prop({ type: 'string' }) })],
    }
    expect(convert(node, definitions)).toEqual({
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      additionalProperties: false,
    })
  })

  it('resolves a multi-hop ref chain when merging', () => {
    const definitions: Record<string, ContractSchemaNode> = {
      Grandparent: { type: 'ref', name: 'Parent' },
      Parent: { type: 'ref', name: 'Base' },
      Base: obj({ id: prop({ type: 'string' }) }),
    }
    const node: ContractSchemaNode = {
      type: 'intersection',
      variants: [{ type: 'ref', name: 'Grandparent' }, obj({ name: prop({ type: 'string' }) })],
    }
    expect(convert(node, definitions)).toEqual({
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id', 'name'],
      additionalProperties: false,
    })
  })

  it('throws when two intersection members declare the same key with conflicting schemas', () => {
    const node: ContractSchemaNode = {
      type: 'intersection',
      variants: [
        obj({ post_type: prop({ type: 'literal', value: 'text' }) }),
        obj({ post_type: prop({ type: 'literal', value: 'topic_recommendation' }) }),
      ],
    }
    expect(() => convert(node)).toThrow(
      'Cannot merge intersection: property "post_type" has conflicting schemas across members',
    )
  })

  it('prefers the narrower schema when one member re-declares a shared optional/nullable key as required', () => {
    const wideFirst: ContractSchemaNode = {
      type: 'intersection',
      variants: [
        obj({
          markdown: prop(
            { type: 'union', variants: [{ type: 'null' }, { type: 'string' }] },
            false,
          ),
        }),
        obj({ markdown: prop({ type: 'string' }) }),
      ],
    }
    const narrowFirst: ContractSchemaNode = {
      type: 'intersection',
      variants: [wideFirst.variants[1]!, wideFirst.variants[0]!],
    }
    for (const node of [wideFirst, narrowFirst]) {
      expect(convert(node)).toEqual({
        type: 'object',
        properties: { markdown: { type: 'string' } },
        required: ['markdown'],
        additionalProperties: false,
      })
    }
  })

  it('prefers the narrower literal when the wider side is a ref to a named union (discriminator narrowing)', () => {
    const definitions: Record<string, ContractSchemaNode> = {
      WidgetType: {
        type: 'union',
        variants: [
          { type: 'literal', value: 'text' },
          { type: 'literal', value: 'topic_recommendation' },
        ],
      },
    }
    const node: ContractSchemaNode = {
      type: 'intersection',
      variants: [
        obj({ post_type: prop({ type: 'ref', name: 'WidgetType' }) }),
        obj({ post_type: prop({ type: 'literal', value: 'topic_recommendation' }) }),
      ],
    }
    expect(convert(node, definitions)).toEqual({
      type: 'object',
      properties: { post_type: { const: 'topic_recommendation' } },
      required: ['post_type'],
      additionalProperties: false,
    })
  })

  it('merges two all-optional objects without a required array', () => {
    const node: ContractSchemaNode = {
      type: 'intersection',
      variants: [
        obj({ a: prop({ type: 'string' }, false) }),
        obj({ b: prop({ type: 'number' }, false) }),
      ],
    }
    expect(convert(node)).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      additionalProperties: false,
    })
  })

  it('falls back to raw allOf when an intersection member is not object-shaped', () => {
    expect(convert({ type: 'intersection', variants: [{ type: 'string' }, obj({})] })).toEqual({
      allOf: [{ type: 'string' }, { type: 'object', properties: {}, additionalProperties: false }],
    })
  })

  it('treats an unresolvable ref member as non-object-shaped', () => {
    expect(
      nodeToOpenApi(
        { type: 'intersection', variants: [{ type: 'ref', name: 'Missing' }, obj({})] },
        noRefsCtx,
      ),
    ).toEqual({
      allOf: [
        { $ref: '#/components/schemas/Missing' },
        { type: 'object', properties: {}, additionalProperties: false },
      ],
    })
  })

  it('falls back to allOf when a ref chain exceeds the hop limit', () => {
    // Ref0 -> Ref1 -> ... -> Ref5 is 5 dereferences deep, exhausting the resolver's hop budget
    // before it ever reaches Ref5's object — even though that object would resolve cleanly one
    // hop earlier.
    const definitions: Record<string, ContractSchemaNode> = {
      Ref0: { type: 'ref', name: 'Ref1' },
      Ref1: { type: 'ref', name: 'Ref2' },
      Ref2: { type: 'ref', name: 'Ref3' },
      Ref3: { type: 'ref', name: 'Ref4' },
      Ref4: { type: 'ref', name: 'Ref5' },
      Ref5: obj({}),
    }
    const node: ContractSchemaNode = {
      type: 'intersection',
      variants: [{ type: 'ref', name: 'Ref0' }, obj({})],
    }
    expect(convert(node, definitions)).toEqual({
      allOf: [
        { $ref: '#/components/schemas/SanitizedRef0' },
        { type: 'object', properties: {}, additionalProperties: false },
      ],
    })
  })
})
