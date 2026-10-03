import { describe, expect, it } from 'vitest'

import type { ExtractedResponseContract } from '../contract-schema/types.mts'
import { buildOpenApiDocument } from './build-openapi-document.mts'
import { hashContractSchema } from './contract-schema-canonical.mts'
import type { ContractSchema } from './contract-schema-types.mts'
import type { ResponseContract } from './operation-types.mts'
import type { OpenApiResponse } from './openapi-types.mts'

function payload(schema: ContractSchema): ExtractedResponseContract {
  return { source: 'event-payload', schema, hash: hashContractSchema(schema) }
}

function stream(overrides: Partial<ResponseContract> = {}): ResponseContract {
  return {
    source: 'GET:/stream',
    method: 'GET',
    routeTemplate: '/stream',
    schema: { root: { type: 'string' }, definitions: {} },
    mediaType: 'text/event-stream',
    bodyKind: 'content',
    ...overrides,
  }
}

function streamDocument(variants: ResponseContract[]) {
  return buildOpenApiDocument({
    title: 'Protocol examples',
    responseContracts: Object.fromEntries(
      variants.map((variant, index) => [String(index), variant]),
    ),
    registeredRoutes: [{ method: 'GET', routeTemplate: '/stream', kind: 'sse', source: 'route' }],
  })
}

describe('protocol response documents', () => {
  it('fails closed when a bodyless 400 also permits framework JSON errors', () => {
    const doc = buildOpenApiDocument({
      title: 'Protocol examples',
      responseContracts: {
        error: {
          source: 'POST:/rpc',
          method: 'POST',
          routeTemplate: '/rpc',
          statusCodes: [400],
          bodyKind: 'none',
          includeDefaultError: true,
          schema: { root: { type: 'null' }, definitions: {} },
        },
      },
    })
    expect(doc['x-unavailable-routes']).toEqual(['POST:/rpc'])
    expect(doc.paths['/rpc']!.post!['x-schema-unavailable-reason']).toContain(
      'status 400 has both body and no-body variants',
    )
  })

  it.each(['text/plain', 'application/problem+json'])(
    'retains framework JSON errors beside an explicit 400 %s body',
    (mediaType) => {
      const doc = buildOpenApiDocument({
        title: 'Protocol examples',
        responseContracts: {
          error: {
            source: 'POST:/rpc',
            method: 'POST',
            routeTemplate: '/rpc',
            statusCodes: [400],
            mediaType,
            includeDefaultError: true,
            schema: { root: { type: 'string' }, definitions: {} },
          },
        },
      })
      expect((doc.paths['/rpc']!.post!.responses['400'] as OpenApiResponse).content).toEqual({
        [mediaType]: { schema: { type: 'string' } },
        'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } },
      })
      expect(doc['x-unavailable-routes']).toEqual([])
    },
  )

  it('renders the stream body as text and registers named event payload definitions', () => {
    const snapshot = {
      type: 'object',
      properties: {
        count: { required: true, schema: { type: 'number' } },
      },
      additionalProperties: false,
    } as const
    const doc = streamDocument([
      stream({
        sseEvents: [
          {
            eventName: 'snapshot',
            contract: payload({
              root: { type: 'ref', name: 'Snapshot' },
              definitions: { Snapshot: snapshot },
            }),
          },
          {
            eventName: 'done',
            contract: payload({
              root: { type: 'object', properties: {}, additionalProperties: false },
              definitions: {},
            }),
          },
        ],
      }),
    ])
    const response = doc.paths['/stream']!.get!.responses['200'] as OpenApiResponse
    expect(response.content).toEqual({
      'text/event-stream': {
        schema: { type: 'string' },
        'x-sse-events': {
          done: { dataSchema: { type: 'object', properties: {}, additionalProperties: false } },
          snapshot: { dataSchema: { $ref: '#/components/schemas/Snapshot' } },
        },
      },
    })
    expect(doc.components.schemas.Snapshot).toEqual({
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
      additionalProperties: false,
    })
    expect(doc['x-unavailable-routes']).toEqual([])
  })

  it('merges all payload variants per event and removes duplicates deterministically', () => {
    const events = ['pending', 'complete', 'pending'].map((value) => ({
      eventName: 'status',
      contract: payload({ root: { type: 'literal', value }, definitions: {} }),
    }))
    const render = (values: typeof events) => {
      const doc = streamDocument(values.map((event) => stream({ sseEvents: [event] })))
      return (doc.paths['/stream']!.get!.responses['200'] as OpenApiResponse).content
    }
    expect(render(events)).toEqual({
      'text/event-stream': {
        schema: { type: 'string' },
        'x-sse-events': {
          status: {
            dataSchema: {
              anyOf: [{ const: 'complete' }, { const: 'pending' }],
            },
          },
        },
      },
    })
    expect(render(events.toReversed())).toEqual(render(events))
  })

  it('keeps a missing event contract unavailable even beside a valid emission', () => {
    const known = stream({
      sseEvents: [
        { eventName: 'status', contract: payload({ root: { type: 'number' }, definitions: {} }) },
      ],
    })
    const doc = streamDocument([known, stream()])
    expect(doc['x-unavailable-routes']).toEqual(['GET:/stream'])
    expect(doc.paths['/stream']!.get!['x-schema-unavailable-reason']).toContain('event payload')
  })

  it('rejects an unknown whole event payload while permitting nested unknown data', () => {
    const unknown = streamDocument([
      stream({
        sseEvents: [
          {
            eventName: 'status',
            contract: payload({ root: { type: 'unknown' }, definitions: {} }),
          },
        ],
      }),
    ])
    expect(unknown['x-unavailable-routes']).toEqual(['GET:/stream'])
    const nested = streamDocument([
      stream({
        sseEvents: [
          {
            eventName: 'status',
            contract: payload({
              root: {
                type: 'object',
                properties: { result: { required: true, schema: { type: 'unknown' } } },
                additionalProperties: false,
              },
              definitions: {},
            }),
          },
        ],
      }),
    ])
    expect(nested['x-unavailable-routes']).toEqual([])
  })

  it('does not attach event metadata to a non-stream response or a bodyless response', () => {
    const sseEvents = [
      { eventName: 'status', contract: payload({ root: { type: 'number' }, definitions: {} }) },
    ]
    for (const overrides of [{ mediaType: 'application/json' }, { bodyKind: 'none' as const }]) {
      const doc = streamDocument([stream({ ...overrides, sseEvents })])
      expect(doc['x-unavailable-routes']).toEqual(['GET:/stream'])
    }
  })

  it('rejects empty names and incompatible payload intersections without dropping the failure', () => {
    const invalidName = streamDocument([
      stream({
        sseEvents: [
          {
            eventName: ' ',
            contract: payload({ root: { type: 'number' }, definitions: {} }),
          },
        ],
      }),
    ])
    expect(invalidName['x-unavailable-routes']).toEqual(['GET:/stream'])
    const member = (type: 'string' | 'number') => ({
      type: 'object' as const,
      properties: { value: { required: true, schema: { type } } },
      additionalProperties: false as const,
    })
    const incompatible = streamDocument([
      stream({
        sseEvents: [
          {
            eventName: 'status',
            contract: payload({
              root: {
                type: 'intersection',
                variants: [member('string'), member('number')],
              },
              definitions: {},
            }),
          },
        ],
      }),
    ])
    expect(incompatible['x-unavailable-routes']).toEqual(['GET:/stream'])
    expect(incompatible.paths['/stream']!.get!['x-schema-unavailable-reason']).toContain(
      'conflicting schemas',
    )
  })

  it('includes framework errors at an explicit transport error status and keeps acknowledgements empty', () => {
    const base = { source: 'POST:/rpc', method: 'POST', routeTemplate: '/rpc' }
    const doc = buildOpenApiDocument({
      title: 'Protocol examples',
      responseContracts: {
        success: {
          ...base,
          statusCodes: [200],
          mediaType: 'application/json',
          schema: { root: { type: 'string' }, definitions: {} },
        },
        error: {
          ...base,
          statusCodes: [400],
          mediaType: 'application/json',
          includeDefaultError: true,
          schema: { root: { type: 'number' }, definitions: {} },
        },
        acknowledgement: {
          ...base,
          statusCodes: [202],
          bodyKind: 'none',
          schema: { root: { type: 'null' }, definitions: {} },
        },
      },
    })
    const responses = doc.paths['/rpc']!.post!.responses
    expect(responses['202']).toEqual({ description: 'Accepted' })
    expect((responses['400'] as OpenApiResponse).content).toEqual({
      'application/json': {
        schema: {
          anyOf: [{ type: 'number' }, { $ref: '#/components/schemas/ErrorBody' }],
        },
      },
    })
    expect((responses['200'] as OpenApiResponse).content).toEqual({
      'application/json': { schema: { type: 'string' } },
    })
    expect(responses.default).toEqual({ $ref: '#/components/responses/Error' })
    expect(doc['x-unavailable-routes']).toEqual([])
  })
})
