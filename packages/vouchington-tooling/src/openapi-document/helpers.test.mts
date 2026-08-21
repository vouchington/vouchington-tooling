import { describe, expect, it } from 'vitest'

import { queryParameters } from './build-openapi-query.mts'
import { mergeVariantSchemas } from './build-openapi-response.mts'
import { buildOperationRequestBody } from './build-openapi-request.mts'
import { createComponentRegistry } from './component-registry.mts'
import { canonicalContractSchemaNode, hashContractSchema } from './contract-schema-canonical.mts'
import { responseStatusCodesForContract, routeShape } from './operation-types.mts'
import { catalogResponse, operationId } from './openapi-route-helpers.mts'
import { objectNode as obj, requiredProperty as prop } from './schema-node-builders.mts'

describe('mergeVariantSchemas', () => {
  it('returns one schema or anyOf for distinct shapes', () => {
    expect(mergeVariantSchemas([{ type: 'string' }, { type: 'string' }])).toEqual({
      type: 'string',
    })
    expect(mergeVariantSchemas([{ type: 'string' }, { type: 'number' }])).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    })
  })
})

describe('queryParameters', () => {
  it('renders each query descriptor kind', () => {
    const parameters = queryParameters({
      q: { kind: 'string', format: 'uuid', description: 'search' },
      mixed: { kind: 'uuid-or-uri' },
      flag: { kind: 'boolean' },
      maybe: { kind: 'nullable-boolean' },
      n: { kind: 'number' },
      count: { kind: 'integer', minimum: 1, maximum: 10, default: 2 },
      page: { kind: 'integer', minimum: 1, maximum: 99 },
      kind: { kind: 'enum', values: ['a', 'b'], default: 'a' },
      sort: { kind: 'enum', values: ['asc', 'desc'] },
      ids: { kind: 'csv-array', items: { kind: 'string' }, style: 'form', explode: false },
    })
    expect(parameters).toHaveLength(10)
    expect(queryParameters(undefined)).toEqual([])
  })
})

describe('buildOperationRequestBody', () => {
  it('omits a missing contract and degrades unavailable ones', () => {
    const registry = createComponentRegistry()
    expect(buildOperationRequestBody(undefined, registry)).toEqual({
      requestBody: undefined,
      unavailable: false,
    })
    const unavailable = buildOperationRequestBody(
      {
        method: 'POST',
        routeTemplate: '/x',
        source: 'x',
        schema: { root: { type: 'unknown' }, definitions: {} },
        unavailableReason: 'raw',
      },
      registry,
    )
    expect(unavailable.unavailable).toBe(true)
  })

  it('converts a JSON request body', () => {
    const registry = createComponentRegistry()
    const result = buildOperationRequestBody(
      {
        method: 'POST',
        routeTemplate: '/x',
        source: 'x',
        schema: { root: obj({ name: prop({ type: 'string' }) }), definitions: {} },
      },
      registry,
    )
    expect(result.unavailable).toBe(false)
    expect(result.requestBody?.content['application/json'].schema).toMatchObject({ type: 'object' })
  })

  it('degrades a request schema that cannot be converted', () => {
    const registry = createComponentRegistry()
    const result = buildOperationRequestBody(
      {
        method: 'POST',
        routeTemplate: '/x',
        source: 'x',
        schema: {
          root: {
            type: 'intersection',
            variants: [
              obj({ kind: prop({ type: 'literal', value: 'a' }) }),
              obj({ kind: prop({ type: 'literal', value: 'b' }) }),
            ],
          },
          definitions: {},
        },
      },
      registry,
    )
    expect(result.unavailable).toBe(true)
    expect(result.requestBody?.['x-request-schema-unavailable-reason']).toMatch(/conflicting/)
  })
})

describe('route helpers', () => {
  it('builds operation ids and catalog placeholders', () => {
    expect(operationId('GET', '/api/v1/widgets/:id')).toBe('get_api_v1_widgets_id')
    expect(routeShape('/widgets/:id')).toBe('/widgets/:')
    expect(catalogResponse('ordinary').unavailable).toBe(true)
    expect(catalogResponse('fixed-no-content', 204).responses[204]).toEqual({
      description: 'No Content',
    })
    expect(() => catalogResponse('fixed-no-content')).toThrow('requires a status')
    expect(catalogResponse('error-only').unavailableReason).toMatch(/no success response/)
    expect(catalogResponse('sse').responses[200]).toMatchObject({
      content: { 'text/event-stream': { schema: {} } },
    })
    expect(catalogResponse('fixed-no-content', 599).responses[599]).toEqual({
      description: 'Response',
    })
  })
})

describe('responseStatusCodesForContract', () => {
  it('uses unknown, explicit, and default status rules', () => {
    expect(
      responseStatusCodesForContract({
        method: 'GET',
        routeTemplate: '/x',
        source: 'x',
        schema: { root: { type: 'unknown' }, definitions: {} },
        statusKnowledge: 'unknown',
      }),
    ).toEqual([])
    expect(
      responseStatusCodesForContract({
        method: 'GET',
        routeTemplate: '/x',
        source: 'x',
        schema: { root: { type: 'unknown' }, definitions: {} },
        statusCodes: [201, 200],
      }),
    ).toEqual([200, 201])
    expect(
      responseStatusCodesForContract({
        method: 'GET',
        routeTemplate: '/x',
        source: 'x',
        schema: { root: { type: 'null' }, definitions: {} },
      }),
    ).toEqual([204])
  })
})

describe('hashContractSchema', () => {
  it('is stable for reordered object keys', () => {
    const left = hashContractSchema({
      root: {
        type: 'object',
        properties: { a: prop({ type: 'string' }), b: prop({ type: 'number' }) },
        additionalProperties: false,
      },
      definitions: {},
    })
    const right = hashContractSchema({
      root: {
        type: 'object',
        properties: { b: prop({ type: 'number' }), a: prop({ type: 'string' }) },
        additionalProperties: false,
      },
      definitions: {},
    })
    expect(left).toBe(right)
    expect(
      hashContractSchema({
        root: { type: 'tuple', items: [{ type: 'string' }, { type: 'number' }], optionalItems: 0 },
        definitions: {},
      }),
    ).toMatch(/^[0-9a-f]{64}$/)
    expect(canonicalContractSchemaNode({ type: 'string' })).toBe(JSON.stringify({ type: 'string' }))
    const unionHash = hashContractSchema({
      root: {
        type: 'union',
        variants: [
          { type: 'literal', value: 'b' },
          { type: 'literal', value: 'a' },
        ],
      },
      definitions: {},
    })
    expect(unionHash).toBe(
      hashContractSchema({
        root: {
          type: 'union',
          variants: [
            { type: 'literal', value: 'a' },
            { type: 'literal', value: 'b' },
          ],
        },
        definitions: {},
      }),
    )
  })
})
