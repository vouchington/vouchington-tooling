import { expect, it } from 'vitest'
import { buildOpenApiDocument } from './build-openapi-document.mts'
import { hashContractSchema } from './contract-schema-canonical.mts'
import type { ResponseContract } from './operation-types.mts'
import type { OpenApiResponse } from './openapi-types.mts'

const json: ResponseContract = {
  source: 'GET:/events',
  method: 'GET',
  routeTemplate: '/events',
  schema: {
    root: { type: 'object', properties: {}, additionalProperties: false },
    definitions: {},
  },
  mediaType: 'application/json',
  bodyKind: 'content',
}
function document(variants: ResponseContract[], kind: 'sse' | 'ordinary' = 'sse') {
  return buildOpenApiDocument({
    title: 'Catalog streams',
    responseContracts: Object.fromEntries(variants.map((row, i) => [String(i), row])),
    registeredRoutes: [{ method: 'GET', routeTemplate: '/events', kind, source: 'route' }],
  })
}
it.each([200, 201])('retains an untyped SSE possibility beside JSON status %s', (status) => {
  const doc = document([{ ...json, statusCodes: [status] }])
  const responses = doc.paths['/events']!.get!.responses
  expect((responses[String(status)] as OpenApiResponse).content).toHaveProperty('application/json')
  expect((responses['200'] as OpenApiResponse).content).toHaveProperty('text/event-stream')
  expect((responses['200'] as OpenApiResponse)['x-schema-unavailable']).toBe(true)
  expect(doc['x-unavailable-routes']).toEqual(['GET:/events'])
})
it('keeps the typed JSON failure reason beside the missing stream payload', () => {
  const doc = document([{ ...json, unavailableReason: 'JSON payload missing' }])
  const operation = doc.paths['/events']!.get!
  expect(operation['x-schema-unavailable-reason']).toContain('JSON payload missing')
  expect(operation['x-schema-unavailable-reason']).toContain('SSE event payload sequence')
})
it('does not add a catalog fallback for complete typed SSE variants', () => {
  const schema = { root: { type: 'string' as const }, definitions: {} }
  const doc = document([
    json,
    {
      ...json,
      mediaType: 'text/event-stream',
      schema,
      sseEvents: [
        {
          eventName: 'done',
          contract: { source: 'event', schema, hash: hashContractSchema(schema) },
        },
      ],
    },
  ])
  expect(doc['x-unavailable-routes']).toEqual([])
  expect(
    (doc.paths['/events']!.get!.responses['200'] as OpenApiResponse).content!['text/event-stream']![
      'x-sse-events'
    ],
  ).toHaveProperty('done')
})
it('keeps ordinary JSON catalog routes complete', () => {
  expect(document([json], 'ordinary')['x-unavailable-routes']).toEqual([])
})
it('retains the stream fallback when an extracted status is unknown', () => {
  const doc = document([{ ...json, statusKnowledge: 'unknown' }])
  expect((doc.paths['/events']!.get!.responses['200'] as OpenApiResponse).content).toHaveProperty(
    'text/event-stream',
  )
  expect(doc['x-unavailable-routes']).toEqual(['GET:/events'])
})
it.each(['unknown-media', 'bodyless'] as const)(
  'does not mistake %s metadata for a typed stream',
  (kind) => {
    const variant: ResponseContract = {
      ...json,
      mediaType: 'text/event-stream',
      statusCodes: [200],
      ...(kind === 'unknown-media' ? { mediaTypeKnowledge: 'unknown' } : { bodyKind: 'none' }),
    }
    const doc = document([variant])
    expect((doc.paths['/events']!.get!.responses['200'] as OpenApiResponse).content).toHaveProperty(
      'text/event-stream',
    )
    expect(doc['x-unavailable-routes']).toEqual(['GET:/events'])
  },
)
