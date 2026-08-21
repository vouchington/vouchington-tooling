import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from './build-openapi-document.mts'
import type { ResponseContract } from './operation-types.mts'
import type { OpenApiResponse } from './openapi-types.mts'
import { objectNode as obj, requiredProperty as prop } from './schema-node-builders.mts'

function contract(
  method: string,
  routeTemplate: string,
  overrides: Partial<ResponseContract> = {},
): ResponseContract {
  return {
    method,
    routeTemplate,
    source: `${method}:${routeTemplate}`,
    schema: { root: { type: 'unknown' }, definitions: {} },
    ...overrides,
  }
}

function buildDoc(contracts: Record<string, ResponseContract>) {
  return buildOpenApiDocument({ title: 'Example API', responseContracts: contracts })
}

describe('buildOpenApiDocument', () => {
  it('documents a single-variant route at its default 200 status', () => {
    const doc = buildDoc({
      'GET:/api/v1/widgets/:id': contract('GET', '/api/v1/widgets/:id', {
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    expect(doc.info).toEqual({ title: 'Example API', version: '1.0.0' })
    expect(doc.paths['/api/v1/widgets/{id}']!.get).toEqual({
      operationId: 'get_api_v1_widgets_id',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'OK',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false,
              },
            },
          },
        },
        default: { $ref: '#/components/responses/Error' },
      },
    })
  })

  it('documents every captured status as its own response', () => {
    const doc = buildDoc({
      'POST:/widgets': contract('POST', '/widgets', {
        statusCodes: [200, 201],
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    const responses = doc.paths['/widgets']!.post!.responses
    expect(responses['200']).toMatchObject({ description: 'OK' })
    expect(responses['201']).toMatchObject({ description: 'Created' })
  })

  it('defaults to 204 when the root is null', () => {
    const doc = buildDoc({
      'DELETE:/api/v1/widgets/:id': contract('DELETE', '/api/v1/widgets/:id', {
        schema: { root: { type: 'null' }, definitions: {} },
      }),
    })
    expect(doc.paths['/api/v1/widgets/{id}']!.delete!.responses['204']).toEqual({
      description: 'No Content',
    })
  })

  it('throws on duplicate normalized route shapes', () => {
    expect(() =>
      buildDoc({
        a: contract('GET', '/widgets/:id'),
        b: contract('GET', '/widgets/:widgetId'),
      }),
    ).toThrow('duplicate normalized route GET:/widgets/:')
  })

  it('documents catalog-only SSE and error-only routes', () => {
    const doc = buildOpenApiDocument({
      title: 'Example API',
      responseContracts: {},
      registeredRoutes: [
        { method: 'GET', routeTemplate: '/stream', kind: 'sse', source: 'routes' },
        { method: 'DELETE', routeTemplate: '/gone', kind: 'error-only', source: 'routes' },
        {
          method: 'POST',
          routeTemplate: '/ack',
          kind: 'fixed-no-content',
          fixedStatus: 204,
          source: 'routes',
        },
      ],
    })
    expect(doc.paths['/stream']!.get!['x-schema-unavailable']).toBe(true)
    expect(doc['x-unavailable-routes']).toEqual(['DELETE:/gone', 'GET:/stream'])
    expect(doc.paths['/ack']!.post!.responses['204']).toEqual({ description: 'No Content' })
  })

  it('accepts matching fixed-no-content variants', () => {
    const doc = buildOpenApiDocument({
      title: 'Example API',
      responseContracts: {
        'POST:/ack': contract('POST', '/ack', {
          bodyKind: 'none',
          statusCodes: [204],
          schema: { root: { type: 'null' }, definitions: {} },
        }),
      },
      registeredRoutes: [
        {
          method: 'POST',
          routeTemplate: '/ack',
          kind: 'fixed-no-content',
          fixedStatus: 204,
          source: 'routes',
        },
      ],
    })
    expect(doc.paths['/ack']!.post!.responses['204']).toEqual({ description: 'No Content' })
  })

  it('documents an ordinary catalog-only route as unavailable', () => {
    const doc = buildOpenApiDocument({
      title: 'Example API',
      responseContracts: {},
      registeredRoutes: [
        { method: 'GET', routeTemplate: '/unknown', kind: 'ordinary', source: 'routes' },
      ],
    })
    expect(doc['x-unavailable-routes']).toEqual(['GET:/unknown'])
  })

  it('rejects fixed-no-content metadata that conflicts with body variants', () => {
    expect(() =>
      buildOpenApiDocument({
        title: 'Example API',
        responseContracts: {
          'POST:/ack': contract('POST', '/ack', {
            bodyKind: 'content',
            schema: { root: obj({ ok: prop({ type: 'boolean' }) }), definitions: {} },
          }),
        },
        registeredRoutes: [
          {
            method: 'POST',
            routeTemplate: '/ack',
            kind: 'fixed-no-content',
            fixedStatus: 204,
            source: 'routes',
          },
        ],
      }),
    ).toThrow('fixed-no-content metadata conflicts')
  })

  it('attaches query parameters and request bodies when provided', () => {
    const doc = buildOpenApiDocument({
      title: 'Example API',
      responseContracts: {
        'GET:/widgets': contract('GET', '/widgets', {
          schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
        }),
      },
      requestContracts: {
        'GET:/widgets': {
          method: 'GET',
          routeTemplate: '/widgets',
          source: 'req',
          schema: { root: obj({ filter: prop({ type: 'string' }) }), definitions: {} },
        },
      },
      queryContracts: {
        'GET:/widgets': {
          method: 'GET',
          routeTemplate: '/widgets',
          parameters: {
            q: { kind: 'string' },
            ids: { kind: 'csv-array', items: { kind: 'string' }, style: 'form', explode: false },
          },
        },
      },
    })
    const operation = doc.paths['/widgets']!.get!
    expect(operation.requestBody).toBeDefined()
    expect(operation.parameters?.some((parameter) => parameter.name === 'q')).toBe(true)
  })

  it('marks unavailable request and response schemas', () => {
    const doc = buildOpenApiDocument({
      title: 'Example API',
      responseContracts: {
        'GET:/broken': contract('GET', '/broken', { unavailableReason: 'cannot extract' }),
      },
      requestContracts: {
        'GET:/broken': {
          method: 'GET',
          routeTemplate: '/broken',
          source: 'req',
          schema: { root: { type: 'unknown' }, definitions: {} },
          unavailableReason: 'raw buffer',
        },
      },
    })
    expect(doc['x-unavailable-routes']).toEqual(['GET:/broken'])
    expect(doc['x-unavailable-request-routes']).toEqual(['GET:/broken'])
  })

  it('exposes the shared Error component', () => {
    const doc = buildDoc({})
    const response = doc.components.responses.Error
    expect(response.description).toBe('Error')
    expect(response.content?.['application/json']?.schema.$ref).toMatch(/#\/components\/schemas\//)
  })

  it('flags unknown media types and 204 bodies', () => {
    const unknownMedia = buildDoc({
      'GET:/x': contract('GET', '/x', {
        mediaTypeKnowledge: 'unknown',
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    expect(unknownMedia['x-unavailable-routes']).toEqual(['GET:/x'])
    const conflict = buildDoc({
      'GET:/y': contract('GET', '/y', {
        statusCodes: [204],
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    expect(conflict['x-unavailable-routes']).toEqual(['GET:/y'])
    const reset = buildDoc({
      'GET:/reset': contract('GET', '/reset', {
        statusCodes: [205],
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    expect(reset['x-unavailable-routes']).toEqual(['GET:/reset'])
    const unknownStatus = buildDoc({
      'GET:/z': contract('GET', '/z', {
        statusKnowledge: 'unknown',
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    expect(unknownStatus['x-unavailable-routes']).toEqual(['GET:/z'])
    const convertFail = buildDoc({
      'GET:/bad': contract('GET', '/bad', {
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
      }),
    })
    expect(convertFail['x-unavailable-routes']).toEqual(['GET:/bad'])
    const bodylessFail = buildDoc({
      'DELETE:/gone': contract('DELETE', '/gone', {
        bodyKind: 'none',
        unavailableReason: 'missing',
        schema: { root: { type: 'null' }, definitions: {} },
      }),
    })
    expect(bodylessFail['x-unavailable-routes']).toEqual(['DELETE:/gone'])
    const mixed = buildDoc({
      a: contract('GET', '/mix', {
        bodyKind: 'none',
        statusCodes: [200],
        schema: { root: { type: 'null' }, definitions: {} },
      }),
      b: contract('GET', '/mix', {
        bodyKind: 'content',
        statusCodes: [200],
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    expect(mixed['x-unavailable-routes']).toEqual(['GET:/mix'])
  })
})

describe('buildOpenApiDocument response variants', () => {
  it('uses a generic description when Node has no status phrase', () => {
    const doc = buildDoc({
      'GET:/odd': contract('GET', '/odd', {
        statusCodes: [599],
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
    })
    expect(doc.paths['/odd']!.get!.responses['599']).toMatchObject({ description: 'Response' })
  })

  it('sorts multiple media types on one status', () => {
    const doc = buildDoc({
      json: contract('GET', '/multi', {
        mediaType: 'application/json',
        schema: { root: obj({ id: prop({ type: 'string' }) }), definitions: {} },
      }),
      text: contract('GET', '/multi', {
        mediaType: 'text/plain',
        schema: { root: { type: 'string' }, definitions: {} },
      }),
    })
    const response = doc.paths['/multi']!.get!.responses['200'] as OpenApiResponse
    expect(Object.keys(response.content ?? {})).toEqual(['application/json', 'text/plain'])
  })

  it('keeps identical same-status variants as a single schema', () => {
    const schema = { root: obj({ id: prop({ type: 'string' }) }), definitions: {} }
    const doc = buildDoc({
      a: contract('GET', '/dup', { schema }),
      b: contract('GET', '/dup', { schema }),
    })
    const response = doc.paths['/dup']!.get!.responses['200'] as OpenApiResponse
    expect(response.content?.['application/json']?.schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    })
  })

  it('merges same-status variants into anyOf', () => {
    const doc = buildDoc({
      a: contract('GET', '/widgets/:id', {
        schema: { root: obj({ name: prop({ type: 'string' }) }), definitions: {} },
      }),
      b: contract('GET', '/widgets/:id', {
        schema: { root: obj({ staff: prop({ type: 'boolean' }) }), definitions: {} },
      }),
    })
    const response = doc.paths['/widgets/{id}']!.get!.responses['200'] as OpenApiResponse
    expect(response.content?.['application/json']?.schema.anyOf).toHaveLength(2)
  })
})
